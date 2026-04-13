import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { channelSchema } from '@echidna-claw/contracts';
import {
  createDeterministicOutboundMessageId,
  createInboundMessageIdempotencyKey,
  encodeTelegramCallbackData,
} from '@echidna-claw/domain';
import {
  createAgent,
  createChannel,
  createCorrelationMetadata,
  createCredentialRef,
} from '@echidna-claw/persistence';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApiServer } from '../../src/app.js';
import {
  INTERNAL_RUNTIME_AUTH_HEADER,
  TELEGRAM_WEBHOOK_SECRET_HEADER,
} from '../../src/http/protection.js';
import { createTestApiConfig } from '../../src/testing/fixtures/api-config.js';

const apps: Array<ReturnType<typeof buildApiServer>> = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        }),
    ),
  );
});

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw.length > 0 ? JSON.parse(raw) : null;
}

async function startTelegramStub(options: {
  answerCallbackResponse?: {
    body: unknown;
    statusCode: number;
  };
  sendMessageResponse?: {
    body: unknown;
    statusCode: number;
  };
} = {}): Promise<{
  baseUrl: string;
  requests: Array<{
    body: unknown;
    method?: string;
    url?: string;
  }>;
}> {
  const requests: Array<{
    body: unknown;
    method?: string;
    url?: string;
  }> = [];
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const body = await readJson(request);
    requests.push({
      body,
      method: request.method,
      url: request.url,
    });

    const sendMessageResponse = options.sendMessageResponse ?? {
      body: {
        ok: true,
        result: {
          message_id: 999,
        },
      },
      statusCode: 200,
    };
    const answerCallbackResponse = options.answerCallbackResponse ?? {
      body: {
        ok: true,
        result: true,
      },
      statusCode: 200,
    };

    if (request.url?.endsWith('/sendMessage')) {
      response.writeHead(sendMessageResponse.statusCode, {
        'content-type': 'application/json',
      });
      response.end(JSON.stringify(sendMessageResponse.body));
      return;
    }

    if (request.url?.endsWith('/answerCallbackQuery')) {
      response.writeHead(answerCallbackResponse.statusCode, {
        'content-type': 'application/json',
      });
      response.end(JSON.stringify(answerCallbackResponse.body));
      return;
    }

    response.writeHead(404, {
      'content-type': 'application/json',
    });
    response.end(JSON.stringify({ ok: false, description: 'Not found' }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  servers.push(server);

  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
  };
}

async function seedActiveTelegramChannel(
  app: ReturnType<typeof buildApiServer>,
  options: {
    agentId?: string;
    botToken?: string;
    channelId?: string;
    externalChatId?: string;
    trustedDisplayName?: string;
    trustedUserHandle?: string;
    trustedUserId?: string;
  } = {},
): Promise<{
  agentId: string;
  channelId: string;
}> {
  const repositories = app.dependencies.adapters.repositories;
  const agentId = options.agentId ?? 'agt_test-agent';
  const channelId = options.channelId ?? 'chn_test-channel';

  await repositories.agents.create(
    createAgent({
      correlation: createCorrelationMetadata({
        idempotencyKey: 'idem_seed-agent',
        traceId: 'trc_seed-agent',
      }),
      id: agentId,
      primaryChannelId: channelId,
    }),
  );

  let channel = await repositories.channels.create(
    channelSchema.parse({
      ...createChannel({
        agentId,
        correlation: createCorrelationMetadata({
          idempotencyKey: 'idem_seed-channel',
          traceId: 'trc_seed-channel',
        }),
        id: channelId,
        ...(options.externalChatId ? { externalChatId: options.externalChatId } : {}),
      }),
      externalChatId: options.externalChatId,
      trustedExternalDisplayName: options.trustedDisplayName,
      trustedExternalUserHandle: options.trustedUserHandle,
      trustedExternalUserId: options.trustedUserId,
    }),
  );

  if (options.botToken) {
    const credential = await repositories.credentials.createCredential({
      credentialRef: createCredentialRef({
        agentId,
        alias: 'telegram-bot',
        id: 'crd_test-telegram-bot',
        provider: 'telegram',
      }),
      plaintext: options.botToken,
    });

    channel = await repositories.channels.replace(
      {
        ...channel.value,
        credentialId: credential.credentialRef.value.id,
      },
      channel.etag,
    );
  }

  return {
    agentId,
    channelId: channel.value.id,
  };
}

function createWebhookHeaders(app: ReturnType<typeof buildApiServer>) {
  return {
    [TELEGRAM_WEBHOOK_SECRET_HEADER]: app.dependencies.config.telegram.webhookSecretToken,
  };
}

describe('Telegram channel adapter', () => {
  it(
    'binds the trusted Telegram identity on first private message, persists it, and deduplicates retries',
    async () => {
    const logs: Array<{ fields: Record<string, unknown>; message: string }> = [];
    const app = buildApiServer(createTestApiConfig(), {
      logSink: (entry) => {
        logs.push({
          fields: entry.fields,
          message: entry.message,
        });
      },
    });
    apps.push(app);

    const seeded = await seedActiveTelegramChannel(app);
    const body = {
      correlation: {
        idempotencyKey: 'idem_malicious',
        traceId: 'trc_malicious',
      },
      message: {
        chat: {
          id: 'chat-42',
          type: 'private',
        },
        from: {
          first_name: 'Trusted',
          id: 'user-42',
          username: 'trusted-user',
        },
        message_id: 77,
        text: 'Check deployment health.',
      },
      update_id: 1001,
    };

    const firstResponse = await app.inject({
      headers: createWebhookHeaders(app),
      method: 'POST',
      payload: body,
      url: `/api/channels/telegram/${seeded.channelId}/webhook`,
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.json()).toEqual({
      accepted: true,
      kind: 'webhook',
    });

    const replayResponse = await app.inject({
      headers: createWebhookHeaders(app),
      method: 'POST',
      payload: body,
      url: `/api/channels/telegram/${seeded.channelId}/webhook`,
    });

    expect(replayResponse.statusCode).toBe(200);

    const channel = await app.dependencies.adapters.repositories.channels.get(
      seeded.agentId,
      seeded.channelId,
    );
    const messages = await app.dependencies.adapters.repositories.messages.listRecentMessages(
      seeded.agentId,
    );

    expect(channel?.value).toMatchObject({
      externalChatId: 'chat-42',
      lastInboundExternalMessageId: '77',
      lastInboundSequence: 1,
      trustedExternalDisplayName: 'Trusted',
      trustedExternalUserHandle: 'trusted-user',
      trustedExternalUserId: 'user-42',
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.value).toMatchObject({
      body: {
        text: 'Check deployment health.',
      },
      externalChatId: 'chat-42',
      externalMessageId: '77',
      externalUpdateId: '1001',
      kind: 'text',
      sequence: 1,
      trusted: true,
    });
    expect(messages[0]?.value.correlation.idempotencyKey).toBe(
      createInboundMessageIdempotencyKey(seeded.agentId as `agt_${string}`, '1001'),
    );
    expect(messages[0]?.value.correlation.traceId).not.toBe('trc_malicious');
    expect(logs.filter((entry) => entry.message === 'trusted_channel_ingress.dispatch')).toHaveLength(1);
    },
    10000,
  );

  it('persists untrusted user mismatches without dispatching trusted ingress', async () => {
    const logs: Array<{ message: string }> = [];
    const app = buildApiServer(createTestApiConfig(), {
      logSink: (entry) => {
        logs.push({ message: entry.message });
      },
    });
    apps.push(app);

    const seeded = await seedActiveTelegramChannel(app, {
      externalChatId: 'chat-42',
      trustedDisplayName: 'Trusted User',
      trustedUserHandle: 'trusted-user',
      trustedUserId: 'user-42',
    });

    const response = await app.inject({
      headers: createWebhookHeaders(app),
      method: 'POST',
      payload: {
        message: {
          chat: {
            id: 'chat-42',
            type: 'private',
          },
          from: {
            first_name: 'Intruder',
            id: 'user-99',
          },
          message_id: 78,
          text: 'Let me in.',
        },
        update_id: 1002,
      },
      url: `/api/channels/telegram/${seeded.channelId}/webhook`,
    });

    expect(response.statusCode).toBe(200);

    const messages = await app.dependencies.adapters.repositories.messages.listRecentMessages(
      seeded.agentId,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.value).toMatchObject({
      kind: 'text',
      trusted: false,
      unsupportedType: 'trust:user_mismatch',
    });
    expect(logs.filter((entry) => entry.message === 'trusted_channel_ingress.dispatch')).toHaveLength(0);
  });

  it('decodes callback actions and acknowledges Telegram callback queries through the bot API', async () => {
    const telegram = await startTelegramStub();
    const logs: Array<{ message: string }> = [];
    const app = buildApiServer(
      createTestApiConfig({
        telegram: {
          apiBaseUrl: telegram.baseUrl,
        },
      }),
      {
        logSink: (entry) => {
          logs.push({ message: entry.message });
        },
      },
    );
    apps.push(app);

    const seeded = await seedActiveTelegramChannel(app, {
      botToken: 'telegram-token',
      externalChatId: 'chat-42',
      trustedDisplayName: 'Trusted User',
      trustedUserHandle: 'trusted-user',
      trustedUserId: 'user-42',
    });

    const response = await app.inject({
      headers: createWebhookHeaders(app),
      method: 'POST',
      payload: {
        callback_query: {
          data: encodeTelegramCallbackData({
            approvalId: 'apr_test-approval',
            decision: 'approve',
            kind: 'approval_decision',
            label: 'Approve',
          }),
          from: {
            first_name: 'Trusted',
            id: 'user-42',
            username: 'trusted-user',
          },
          id: 'cbq-1',
          message: {
            chat: {
              id: 'chat-42',
              type: 'private',
            },
            message_id: 88,
            text: 'Approve deployment?',
          },
        },
        update_id: 1003,
      },
      url: `/api/channels/telegram/${seeded.channelId}/webhook`,
    });

    expect(response.statusCode).toBe(200);

    const messages = await app.dependencies.adapters.repositories.messages.listRecentMessages(
      seeded.agentId,
    );

    expect(messages[0]?.value).toMatchObject({
      callbackData: encodeTelegramCallbackData({
        approvalId: 'apr_test-approval',
        decision: 'approve',
        kind: 'approval_decision',
        label: 'Approve',
      }),
      kind: 'callback_query',
      trusted: true,
    });
    expect(logs.filter((entry) => entry.message === 'approval_action.dispatch')).toHaveLength(1);
    expect(telegram.requests.find((request) => request.url?.endsWith('/answerCallbackQuery'))?.body).toEqual(
      {
        callback_query_id: 'cbq-1',
        show_alert: false,
        text: 'Decision recorded.',
      },
    );
  });

  it('keeps callback webhooks successful when Telegram credential decryption fails', async () => {
    const telegram = await startTelegramStub();
    const app = buildApiServer(
      createTestApiConfig({
        telegram: {
          apiBaseUrl: telegram.baseUrl,
        },
      }),
    );
    apps.push(app);

    const seeded = await seedActiveTelegramChannel(app, {
      botToken: 'telegram-token',
      externalChatId: 'chat-42',
      trustedDisplayName: 'Trusted User',
      trustedUserHandle: 'trusted-user',
      trustedUserId: 'user-42',
    });
    app.dependencies.adapters.repositories.credentials.decryptCredential = async () => {
      throw new Error('Key Vault crypto unavailable');
    };

    const response = await app.inject({
      headers: createWebhookHeaders(app),
      method: 'POST',
      payload: {
        callback_query: {
          data: encodeTelegramCallbackData({
            approvalId: 'apr_test-approval',
            decision: 'approve',
            kind: 'approval_decision',
            label: 'Approve',
          }),
          from: {
            first_name: 'Trusted',
            id: 'user-42',
            username: 'trusted-user',
          },
          id: 'cbq-credential-error',
          message: {
            chat: {
              id: 'chat-42',
              type: 'private',
            },
            message_id: 89,
            text: 'Approve deployment?',
          },
        },
        update_id: 1004,
      },
      url: `/api/channels/telegram/${seeded.channelId}/webhook`,
    });

    expect(response.statusCode).toBe(200);
    expect(telegram.requests.find((request) => request.url?.endsWith('/answerCallbackQuery'))).toBeUndefined();
  });

  it('sends outbound messages through the bound Telegram bot and persists the sent state', async () => {
    const telegram = await startTelegramStub();
    const app = buildApiServer(
      createTestApiConfig({
        telegram: {
          apiBaseUrl: telegram.baseUrl,
        },
      }),
    );
    apps.push(app);

    const seeded = await seedActiveTelegramChannel(app, {
      botToken: 'telegram-token',
      externalChatId: 'chat-42',
      trustedDisplayName: 'Trusted User',
      trustedUserHandle: 'trusted-user',
      trustedUserId: 'user-42',
    });

    const response = await app.inject({
      headers: {
        [INTERNAL_RUNTIME_AUTH_HEADER]: app.dependencies.config.internalRuntime.authToken,
      },
      method: 'POST',
      payload: {
        actions: [
          {
            approvalId: 'apr_test-approval',
            decision: 'approve',
            kind: 'approval_decision',
            label: 'Approve',
          },
          {
            approvalId: 'apr_test-approval',
            decision: 'reject',
            kind: 'approval_decision',
            label: 'Reject',
          },
        ],
        agentId: seeded.agentId,
        channelId: seeded.channelId,
        correlation: {
          idempotencyKey: 'idem_outbound-1',
          traceId: 'trc_outbound-1',
        },
        text: 'Approve the deployment restart?',
      },
      url: '/api/internal/outbound-messages/messages',
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      accepted: true,
      outboundMessageId: createDeterministicOutboundMessageId(
        seeded.agentId as `agt_${string}`,
        'idem_outbound-1',
      ),
      status: 'sent',
    });

    const outboundMessage = await app.dependencies.adapters.repositories.messages.getOutboundMessage(
      seeded.agentId,
      createDeterministicOutboundMessageId(seeded.agentId as `agt_${string}`, 'idem_outbound-1'),
    );
    const channel = await app.dependencies.adapters.repositories.channels.get(
      seeded.agentId,
      seeded.channelId,
    );

    expect(outboundMessage?.value).toMatchObject({
      actions: [
        {
          approvalId: 'apr_test-approval',
          decision: 'approve',
          kind: 'approval_decision',
          label: 'Approve',
        },
        {
          approvalId: 'apr_test-approval',
          decision: 'reject',
          kind: 'approval_decision',
          label: 'Reject',
        },
      ],
      deliveryState: 'sent',
      externalMessageId: '999',
    });
    expect(channel?.value.lastOutboundExternalMessageId).toBe('999');
    expect(telegram.requests.find((request) => request.url?.endsWith('/sendMessage'))?.body).toEqual({
      chat_id: 'chat-42',
      reply_markup: {
        inline_keyboard: [
          [
            {
              callback_data: 'ec1|a|apr_test-approval|y',
              text: 'Approve',
            },
            {
              callback_data: 'ec1|a|apr_test-approval|n',
              text: 'Reject',
            },
          ],
        ],
      },
      text: 'Approve the deployment restart?',
    });
  });

  it('maps Telegram delivery failures into durable failed outbound records', async () => {
    const telegram = await startTelegramStub({
      sendMessageResponse: {
        body: {
          description: 'Forbidden: bot was blocked by the user',
          ok: false,
        },
        statusCode: 403,
      },
    });
    const app = buildApiServer(
      createTestApiConfig({
        telegram: {
          apiBaseUrl: telegram.baseUrl,
        },
      }),
    );
    apps.push(app);

    const seeded = await seedActiveTelegramChannel(app, {
      botToken: 'telegram-token',
      externalChatId: 'chat-42',
      trustedDisplayName: 'Trusted User',
      trustedUserHandle: 'trusted-user',
      trustedUserId: 'user-42',
    });

    const outboundMessageId = createDeterministicOutboundMessageId(
      seeded.agentId as `agt_${string}`,
      'idem_outbound-failure',
    );
    const response = await app.inject({
      headers: {
        [INTERNAL_RUNTIME_AUTH_HEADER]: app.dependencies.config.internalRuntime.authToken,
      },
      method: 'POST',
      payload: {
        agentId: seeded.agentId,
        channelId: seeded.channelId,
        correlation: {
          idempotencyKey: 'idem_outbound-failure',
          traceId: 'trc_outbound-failure',
        },
        text: 'This will fail.',
      },
      url: '/api/internal/outbound-messages/messages',
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      accepted: true,
      outboundMessageId,
      status: 'failed',
    });

    const outboundMessage = await app.dependencies.adapters.repositories.messages.getOutboundMessage(
      seeded.agentId,
      outboundMessageId,
    );

    expect(outboundMessage?.value).toMatchObject({
      deliveryState: 'failed',
      failureCode: 'telegram_forbidden',
      failureMessage: 'Forbidden: bot was blocked by the user',
    });
  });

  it('persists credential failures when Telegram credential decryption throws', async () => {
    const app = buildApiServer(createTestApiConfig());
    apps.push(app);

    const seeded = await seedActiveTelegramChannel(app, {
      botToken: 'telegram-token',
      externalChatId: 'chat-42',
      trustedDisplayName: 'Trusted User',
      trustedUserHandle: 'trusted-user',
      trustedUserId: 'user-42',
    });
    app.dependencies.adapters.repositories.credentials.decryptCredential = async () => {
      throw new Error('Key Vault crypto unavailable');
    };

    const outboundMessageId = createDeterministicOutboundMessageId(
      seeded.agentId as `agt_${string}`,
      'idem_outbound-kv-failure',
    );
    const response = await app.inject({
      headers: {
        [INTERNAL_RUNTIME_AUTH_HEADER]: app.dependencies.config.internalRuntime.authToken,
      },
      method: 'POST',
      payload: {
        agentId: seeded.agentId,
        channelId: seeded.channelId,
        correlation: {
          idempotencyKey: 'idem_outbound-kv-failure',
          traceId: 'trc_outbound-kv-failure',
        },
        text: 'This should fail gracefully.',
      },
      url: '/api/internal/outbound-messages/messages',
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      accepted: true,
      outboundMessageId,
      status: 'failed',
    });

    const outboundMessage = await app.dependencies.adapters.repositories.messages.getOutboundMessage(
      seeded.agentId,
      outboundMessageId,
    );

    expect(outboundMessage?.value).toMatchObject({
      deliveryState: 'failed',
      failureCode: 'credential_unavailable',
      failureMessage: 'Telegram credential crd_test-telegram-bot could not be decrypted: Key Vault crypto unavailable',
    });
  });
});

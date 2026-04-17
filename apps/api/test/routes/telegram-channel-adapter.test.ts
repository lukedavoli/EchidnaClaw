import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { channelSchema } from '@echidna-claw/contracts';
import {
  createDeterministicOutboundMessageId,
  createInboundMessageIdempotencyKey,
  encodeTelegramCallbackData,
} from '@echidna-claw/domain';
import {
  createApproval,
  createAgent,
  createChannel,
  createCorrelationMetadata,
  createCredentialRef,
  createTask,
  createWorkingContext,
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
  getMeResponse?: {
    body: unknown;
    statusCode: number;
  };
  sendMessageResponse?: {
    body: unknown;
    statusCode: number;
  };
  setWebhookResponse?: {
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
    const getMeResponse = options.getMeResponse ?? {
      body: {
        ok: true,
        result: {
          first_name: 'Ops Bot',
          id: 321,
          username: 'ops-triage-bot',
        },
      },
      statusCode: 200,
    };
    const setWebhookResponse = options.setWebhookResponse ?? {
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

    if (request.url?.endsWith('/getMe')) {
      response.writeHead(getMeResponse.statusCode, {
        'content-type': 'application/json',
      });
      response.end(JSON.stringify(getMeResponse.body));
      return;
    }

    if (request.url?.endsWith('/setWebhook')) {
      response.writeHead(setWebhookResponse.statusCode, {
        'content-type': 'application/json',
      });
      response.end(JSON.stringify(setWebhookResponse.body));
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
        alias: 'telegram-bot-token',
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

async function seedPendingApproval(
  app: ReturnType<typeof buildApiServer>,
  input: {
    agentId: string;
    approvalId?: string;
    channelId: string;
    taskId?: string;
    workingContextId?: string;
  },
): Promise<void> {
  const repositories = app.dependencies.adapters.repositories;
  const approvalId = input.approvalId ?? 'apr_test-approval';
  const taskId = input.taskId ?? 'tsk_test-approval';
  const workingContextId = input.workingContextId ?? 'ctx_test-approval';

  await repositories.workingContexts.create(
    createWorkingContext({
      agentId: input.agentId,
      correlation: createCorrelationMetadata({
        idempotencyKey: 'idem_seed-approval-context',
        taskId,
        traceId: 'trc_seed-approval-context',
      }),
      id: workingContextId,
      pendingApprovalIds: [approvalId],
    }),
  );
  await repositories.tasks.createTask(
    createTask({
      activeApprovalId: approvalId,
      activeTaskEnvelopeId: null,
      agentId: input.agentId,
      correlation: createCorrelationMetadata({
        approvalId,
        idempotencyKey: 'idem_seed-approval-task',
        taskId,
        traceId: 'trc_seed-approval-task',
      }),
      currentRunJournalId: null,
      id: taskId,
      requestedOutcome: 'Approve the deployment action.',
      state: 'waiting_for_user',
    }),
  );
  await repositories.approvals.create(
    createApproval({
      agentId: input.agentId,
      correlation: createCorrelationMetadata({
        approvalId,
        idempotencyKey: 'idem_seed-approval-record',
        taskId,
        traceId: 'trc_seed-approval-record',
      }),
      id: approvalId,
      requestChannelId: input.channelId,
      summary: 'Approve the deployment action.',
      taskId,
      taskEnvelopeId: null,
    }),
  );
}

function createEmptyEffectSummary() {
  return {
    approvalRequested: false,
    credentialRequested: false,
    memoryOperationRequested: false,
    sandboxRequested: false,
    scheduleChangeRequested: false,
    taskRequested: false,
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
    const inboundMessages = messages.filter(
      (message) => message.value.recordType === 'inbound_message',
    );

    expect(channel?.value).toMatchObject({
      externalChatId: 'chat-42',
      lastInboundExternalMessageId: '77',
      lastInboundSequence: 1,
      trustedExternalDisplayName: 'Trusted',
      trustedExternalUserHandle: 'trusted-user',
      trustedExternalUserId: 'user-42',
    });
    expect(inboundMessages).toHaveLength(1);
    expect(inboundMessages[0]?.value).toMatchObject({
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
    expect(inboundMessages[0]?.value.correlation.idempotencyKey).toBe(
      createInboundMessageIdempotencyKey(seeded.agentId as `agt_${string}`, '1001'),
    );
    expect(inboundMessages[0]?.value.correlation.traceId).not.toBe('trc_malicious');
    expect(logs.filter((entry) => entry.message === 'trusted_channel_ingress.dispatch')).toHaveLength(1);
    },
    10000,
  );

  it('coalesces rapid trusted messages into one Head turn when debounce is enabled', async () => {
    const telegram = await startTelegramStub();
    const logs: Array<{ message: string }> = [];
    const app = buildApiServer(
      createTestApiConfig({
        head: {
          debounceWindowMs: 25,
        },
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
    });

    const firstWebhook = app.inject({
      headers: createWebhookHeaders(app),
      method: 'POST',
      payload: {
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
          message_id: 90,
          text: 'First fragment.',
        },
        update_id: 1101,
      },
      url: `/api/channels/telegram/${seeded.channelId}/webhook`,
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const secondWebhook = app.inject({
      headers: createWebhookHeaders(app),
      method: 'POST',
      payload: {
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
          message_id: 91,
          text: 'Second fragment.',
        },
        update_id: 1102,
      },
      url: `/api/channels/telegram/${seeded.channelId}/webhook`,
    });

    const [firstResponse, secondResponse] = await Promise.all([firstWebhook, secondWebhook]);
    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(200);

    const sendRequests = telegram.requests.filter((request) =>
      request.url?.endsWith('/sendMessage'),
    );
    expect(sendRequests).toHaveLength(1);
    expect(sendRequests[0]?.body).toMatchObject({
      chat_id: 'chat-42',
      text: 'Stubbed Head reply: Second fragment.',
    });
    expect(logs.filter((entry) => entry.message === 'head_runtime.start_turn')).toHaveLength(1);
  });

  it('suppresses stale replies when a newer trusted message supersedes an in-flight Head turn', async () => {
    const telegram = await startTelegramStub();
    const logs: Array<{ message: string }> = [];
    const app = buildApiServer(
      createTestApiConfig({
        head: {
          debounceWindowMs: 0,
        },
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
    });
    let executeCount = 0;
    let releaseFirstTurn!: () => void;
    const firstTurnBlocked = new Promise<void>((resolve) => {
      releaseFirstTurn = resolve;
    });

    app.dependencies.adapters.foundry.headRuntime.executeTurn = async (input) => {
      executeCount += 1;
      if (executeCount === 1) {
        await firstTurnBlocked;
      }

      const replyText =
        executeCount === 1
          ? 'Stubbed Head reply: First message.'
          : 'Stubbed Head reply: Second message.';

      return {
        assistantText: replyText,
        completionKind: 'reply',
        conversationCursor: `stub-conversation:${input.headTurnId}`,
        deferredDirectives: [],
        effectSummary: createEmptyEffectSummary(),
        providerConversationId: `stub-conversation:${input.headTurnId}`,
        providerRunId: `stub-run:${input.headTurnId}`,
      };
    };

    const firstWebhook = app.inject({
      headers: createWebhookHeaders(app),
      method: 'POST',
      payload: {
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
          message_id: 92,
          text: 'First message.',
        },
        update_id: 1201,
      },
      url: `/api/channels/telegram/${seeded.channelId}/webhook`,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    const secondWebhook = await app.inject({
      headers: createWebhookHeaders(app),
      method: 'POST',
      payload: {
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
          message_id: 93,
          text: 'Second message.',
        },
        update_id: 1202,
      },
      url: `/api/channels/telegram/${seeded.channelId}/webhook`,
    });

    releaseFirstTurn();
    const firstResponse = await firstWebhook;

    expect(firstResponse.statusCode).toBe(200);
    expect(secondWebhook.statusCode).toBe(200);

    const sendRequests = telegram.requests.filter((request) =>
      request.url?.endsWith('/sendMessage'),
    );
    expect(sendRequests).toHaveLength(1);
    expect(sendRequests[0]?.body).toMatchObject({
      chat_id: 'chat-42',
      text: 'Stubbed Head reply: Second message.',
    });
    expect(logs.filter((entry) => entry.message === 'trusted_channel_ingress.superseded')).toHaveLength(1);
  });

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
    await seedPendingApproval(app, seeded);

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
    await seedPendingApproval(app, seeded);
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

  it('provisions a Telegram bot through the admin handoff route and completes the bootstrap bind', async () => {
    const telegram = await startTelegramStub();
    const app = buildApiServer(
      createTestApiConfig({
        publicBaseUrl: 'https://api.example.test',
        telegram: {
          apiBaseUrl: telegram.baseUrl,
        },
      }),
    );
    apps.push(app);

    const created = await app.inject({
      method: 'POST',
      payload: {
        correlation: {
          idempotencyKey: 'idem_step20-create',
          traceId: 'trc_step20-create',
        },
        name: 'Step 20 Agent',
      },
      url: '/api/admin/agents',
    });

    expect(created.statusCode).toBe(201);
    const createdBody = created.json();
    const agentId = createdBody.agent.id as string;
    const channelId = createdBody.primaryChannel.id as string;

    const initialHandoff = await app.inject({
      method: 'GET',
      url: `/api/admin/agents/${agentId}/telegram-provisioning`,
    });

    expect(initialHandoff.statusCode).toBe(200);
    expect(initialHandoff.json()).toMatchObject({
      agentId,
      channelId,
      provider: 'telegram',
      requiresBotToken: true,
      state: 'pending_operator_action',
    });

    const tokenSubmission = await app.inject({
      method: 'POST',
      payload: {
        botToken: 'telegram-token-step20',
        correlation: {
          idempotencyKey: 'idem_step20-token',
          traceId: 'trc_step20-token',
        },
      },
      url: `/api/admin/agents/${agentId}/telegram-provisioning/token`,
    });

    expect(tokenSubmission.statusCode).toBe(200);
    const handoff = tokenSubmission.json();
    expect(handoff).toMatchObject({
      agentId,
      botDisplayName: 'Ops Bot',
      botHandle: 'ops-triage-bot',
      channelId,
      provider: 'telegram',
      requiresBotToken: false,
      state: 'awaiting_operator_binding',
    });
    expect(handoff.bootstrapCode).toEqual(expect.any(String));
    expect(handoff.openTelegramUrl).toContain('https://t.me/ops-triage-bot?start=');
    expect(telegram.requests.find((request) => request.url?.endsWith('/getMe'))?.body).toEqual({});
    expect(telegram.requests.find((request) => request.url?.endsWith('/setWebhook'))?.body).toEqual({
      secret_token: 'local-telegram-webhook-token',
      url: `https://api.example.test/api/channels/telegram/${channelId}/webhook`,
    });

    const bootstrapWebhook = await app.inject({
      headers: createWebhookHeaders(app),
      method: 'POST',
      payload: {
        message: {
          chat: {
            id: 'chat-step20',
            type: 'private',
          },
          from: {
            first_name: 'Step Twenty',
            id: 'user-step20',
            username: 'step20-user',
          },
          message_id: 150,
          text: `/start ${handoff.bootstrapCode}`,
        },
        update_id: 2201,
      },
      url: `/api/channels/telegram/${channelId}/webhook`,
    });

    expect(bootstrapWebhook.statusCode).toBe(200);

    const agentDetail = await app.inject({
      method: 'GET',
      url: `/api/admin/agents/${agentId}`,
    });

    expect(agentDetail.statusCode).toBe(200);
    expect(agentDetail.json()).toMatchObject({
      agent: {
        provisioningState: 'active',
      },
      primaryChannel: {
        botDisplayName: 'Ops Bot',
        botUserId: '321',
        externalChatId: 'chat-step20',
        externalHandle: 'ops-triage-bot',
        state: 'active',
      },
    });

    const completedHandoff = await app.inject({
      method: 'GET',
      url: `/api/admin/agents/${agentId}/telegram-provisioning`,
    });

    expect(completedHandoff.statusCode).toBe(200);
    expect(completedHandoff.json()).toMatchObject({
      agentId,
      channelId,
      provider: 'telegram',
      requiresBotToken: false,
      state: 'completed',
    });
  });

  it('records invalid Telegram bot tokens as failed provisioning attempts and supports retry handoff rotation', async () => {
    const telegram = await startTelegramStub({
      getMeResponse: {
        body: {
          description: 'Unauthorized',
          ok: false,
        },
        statusCode: 400,
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

    const created = await app.inject({
      method: 'POST',
      payload: {
        correlation: {
          idempotencyKey: 'idem_step20-invalid-create',
          traceId: 'trc_step20-invalid-create',
        },
        name: 'Invalid Token Agent',
      },
      url: '/api/admin/agents',
    });

    const agentId = created.json().agent.id as string;

    const invalidToken = await app.inject({
      method: 'POST',
      payload: {
        botToken: 'bad-token',
        correlation: {
          idempotencyKey: 'idem_step20-invalid-token',
          traceId: 'trc_step20-invalid-token',
        },
      },
      url: `/api/admin/agents/${agentId}/telegram-provisioning/token`,
    });

    expect(invalidToken.statusCode).toBe(400);
    expect(invalidToken.json().error.code).toBe('validation_failed');

    const failedHandoff = await app.inject({
      method: 'GET',
      url: `/api/admin/agents/${agentId}/telegram-provisioning`,
    });

    expect(failedHandoff.statusCode).toBe(200);
    expect(failedHandoff.json()).toMatchObject({
      agentId,
      lastErrorCode: 'telegram_token_invalid',
      requiresBotToken: true,
      state: 'failed',
    });

    const retried = await app.inject({
      method: 'POST',
      payload: {
        correlation: {
          idempotencyKey: 'idem_step20-invalid-retry',
          traceId: 'trc_step20-invalid-retry',
        },
      },
      url: `/api/admin/agents/${agentId}/provisioning/retry`,
    });

    expect(retried.statusCode).toBe(200);

    const retriedHandoff = await app.inject({
      method: 'GET',
      url: `/api/admin/agents/${agentId}/telegram-provisioning`,
    });

    expect(retriedHandoff.statusCode).toBe(200);
    expect(retriedHandoff.json()).toMatchObject({
      agentId,
      attemptNumber: 2,
      requiresBotToken: true,
      state: 'pending_operator_action',
    });
  });

  it('expires bootstrap codes on webhook receipt and keeps the channel inactive until retry', async () => {
    const telegram = await startTelegramStub();
    const app = buildApiServer(
      createTestApiConfig({
        publicBaseUrl: 'https://api.example.test',
        telegram: {
          apiBaseUrl: telegram.baseUrl,
        },
      }),
    );
    apps.push(app);

    const created = await app.inject({
      method: 'POST',
      payload: {
        correlation: {
          idempotencyKey: 'idem_step20-expire-create',
          traceId: 'trc_step20-expire-create',
        },
        name: 'Expired Bootstrap Agent',
      },
      url: '/api/admin/agents',
    });

    const agentId = created.json().agent.id as string;
    const channelId = created.json().primaryChannel.id as string;
    const tokenSubmission = await app.inject({
      method: 'POST',
      payload: {
        botToken: 'telegram-token-expire',
        correlation: {
          idempotencyKey: 'idem_step20-expire-token',
          traceId: 'trc_step20-expire-token',
        },
      },
      url: `/api/admin/agents/${agentId}/telegram-provisioning/token`,
    });

    const handoff = tokenSubmission.json();
    const session = await app.dependencies.adapters.repositories.telegramProvisioningSessions.getLatestByAgent(
      agentId,
    );
    await app.dependencies.adapters.repositories.telegramProvisioningSessions.replace(
      {
        ...session!.value,
        bootstrapExpiresAt: '2026-04-13T00:00:00.000Z',
      },
      session!.etag,
    );

    const expiredWebhook = await app.inject({
      headers: createWebhookHeaders(app),
      method: 'POST',
      payload: {
        message: {
          chat: {
            id: 'chat-expired',
            type: 'private',
          },
          from: {
            first_name: 'Expired',
            id: 'user-expired',
          },
          message_id: 151,
          text: `/start ${handoff.bootstrapCode}`,
        },
        update_id: 2202,
      },
      url: `/api/channels/telegram/${channelId}/webhook`,
    });

    expect(expiredWebhook.statusCode).toBe(200);

    const failedHandoff = await app.inject({
      method: 'GET',
      url: `/api/admin/agents/${agentId}/telegram-provisioning`,
    });

    expect(failedHandoff.statusCode).toBe(200);
    expect(failedHandoff.json()).toMatchObject({
      agentId,
      lastErrorCode: 'telegram_bootstrap_expired',
      state: 'failed',
    });
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

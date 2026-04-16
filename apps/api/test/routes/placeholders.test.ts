import { afterEach, describe, expect, it } from 'vitest';
import type { WorkingContext } from '@echidna-claw/contracts';
import {
  createAgent,
  createChannel,
  createCorrelationMetadata,
  createCredentialRef,
  createIdempotencyRecord,
  createInboundMessage,
  createWorkingContext,
} from '@echidna-claw/persistence';

import { buildApiServer } from '../../src/app.js';
import { INTERNAL_RUNTIME_AUTH_HEADER } from '../../src/http/protection.js';
import { createTestApiConfig } from '../../src/testing/fixtures/api-config.js';

const apps: Array<ReturnType<typeof buildApiServer>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createCorrelation(idempotencyKey = 'idem_request-1', traceId = 'trc_trace-1') {
  return {
    idempotencyKey,
    traceId,
  };
}

async function seedHeadRuntimeRecords(app: ReturnType<typeof buildApiServer>, options: {
  messageText: string;
  trusted?: boolean;
  workingContextOverrides?: Partial<WorkingContext>;
}): Promise<{
  agentId: 'agt_test-agent';
  channelId: 'chn_test-channel';
  inboundMessageId: 'inm_message-1';
  workingContextId: 'ctx_main-context';
}> {
  const repositories = app.dependencies.adapters.repositories;
  const correlation = createCorrelationMetadata({
    idempotencyKey: 'idem_seed-head-runtime',
    traceId: 'trc_seed-head-runtime',
  });

  await repositories.agents.create(
    createAgent({
      id: 'agt_test-agent',
      correlation,
      lifecycleState: 'active',
      primaryChannelId: 'chn_test-channel',
      provisioningState: 'active',
    }),
  );

  const createdChannel = await repositories.channels.create(
    createChannel({
      agentId: 'agt_test-agent',
      correlation,
      id: 'chn_test-channel',
      lastInboundSequence: 0,
      state: 'active',
    }),
  );

  await repositories.workingContexts.create(
    createWorkingContext({
      agentId: 'agt_test-agent',
      correlation,
      id: 'ctx_main-context',
      latestInboundSequence: 0,
      latestProcessedSequence: 0,
      episodeLocalDate: '2026-04-13',
      episodeTurnCount: 0,
      summary: 'Deployment monitoring summary.',
      ...options.workingContextOverrides,
    }),
  );

  const message = createInboundMessage({
    agentId: 'agt_test-agent',
    body: {
      text: options.messageText,
      artifacts: [],
    },
    channelId: 'chn_test-channel',
    correlation,
    id: 'inm_message-1',
    sequence: 1,
    trusted: options.trusted ?? true,
  });

  await repositories.messages.appendInboundMessage({
    channel: {
      ...createdChannel.value,
      lastInboundSequence: 1,
      lastExternalMessageId: message.externalMessageId,
      updatedAt: message.receivedAt,
    },
    channelEtag: createdChannel.etag,
    idempotencyRecord: createIdempotencyRecord({
      agentId: 'agt_test-agent',
      correlation,
      id: 'idr_message-1',
      key: 'telegram-update-1',
      resultReference: 'inm_message-1',
    }),
    message,
  });

  return {
    agentId: 'agt_test-agent',
    channelId: 'chn_test-channel',
    inboundMessageId: 'inm_message-1',
    workingContextId: 'ctx_main-context',
  };
}

describe('route implementations and head runtime behavior', () => {
  it('creates, lists, reads, and replays agent creation deterministically', async () => {
    const app = buildApiServer(createTestApiConfig());
    apps.push(app);

    const createPayload = {
      correlation: createCorrelation('idem_request-create', 'trc_trace-create'),
      name: 'Launch Agent',
    };

    const created = await app.inject({
      method: 'POST',
      payload: createPayload,
      url: '/api/admin/agents',
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      agent: {
        name: 'Launch Agent',
        provisioningState: 'pending_provisioning',
      },
      primaryChannel: {
        state: 'pending_provisioning',
      },
    });

    const replayed = await app.inject({
      method: 'POST',
      payload: createPayload,
      url: '/api/admin/agents',
    });

    expect(replayed.statusCode).toBe(201);
    expect(replayed.json().agent.id).toBe(created.json().agent.id);

    const listed = await app.inject({
      method: 'GET',
      url: '/api/admin/agents',
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0]).toMatchObject({
      agent: {
        id: created.json().agent.id,
      },
    });

    const detailed = await app.inject({
      method: 'GET',
      url: `/api/admin/agents/${created.json().agent.id}`,
    });

    expect(detailed.statusCode).toBe(200);
    expect(detailed.json()).toMatchObject({
      agent: {
        id: created.json().agent.id,
      },
      primaryChannel: {
        id: created.json().agent.primaryChannelId,
      },
    });
  });

  it('archives, restores, and retries provisioning for failed agents', async () => {
    const app = buildApiServer(createTestApiConfig());
    apps.push(app);

    const created = await app.inject({
      method: 'POST',
      payload: {
        correlation: createCorrelation('idem_request-lifecycle', 'trc_trace-lifecycle'),
        name: 'Lifecycle Agent',
        timeZone: 'UTC',
      },
      url: '/api/admin/agents',
    });

    const agentId = created.json().agent.id;

    const archived = await app.inject({
      method: 'POST',
      payload: {
        correlation: createCorrelation('idem_request-archive', 'trc_trace-archive'),
      },
      url: `/api/admin/agents/${agentId}/soft-delete`,
    });

    expect(archived.statusCode).toBe(200);
    expect(archived.json()).toMatchObject({
      agent: {
        lifecycleState: 'soft_deleted',
      },
    });

    const restored = await app.inject({
      method: 'POST',
      payload: {
        correlation: createCorrelation('idem_request-restore', 'trc_trace-restore'),
      },
      url: `/api/admin/agents/${agentId}/restore`,
    });

    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({
      agent: {
        lifecycleState: 'active',
      },
    });

    await app.dependencies.services.webControlPlaneService.recordAgentProvisioningFailure({
      agentId,
      correlation: {
        ...createCorrelation('idem_request-failure', 'trc_trace-failure'),
        requestedBy: {
          displayName: 'Route Test',
          id: 'opr_route-test',
          kind: 'operator',
        },
      },
      errorCode: 'telegram_bind_failed',
      errorMessage: 'Unable to bind the Telegram bot.',
      failedAt: '2026-04-13T12:00:00.000Z',
    });

    const retried = await app.inject({
      method: 'POST',
      payload: {
        correlation: createCorrelation('idem_request-retry', 'trc_trace-retry'),
      },
      url: `/api/admin/agents/${agentId}/provisioning/retry`,
    });

    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toMatchObject({
      agent: {
        provisioningState: 'pending_provisioning',
      },
      primaryChannel: {
        recoveryAttemptCount: 1,
        state: 'pending_provisioning',
      },
    });
  });

  it('validates route params before calling services', async () => {
    const app = buildApiServer(createTestApiConfig());
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/approvals/not-a-valid-id',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('validation_failed');
  });

  it('lists and revokes stored credentials through the admin routes', async () => {
    const app = buildApiServer(createTestApiConfig());
    apps.push(app);
    const repositories = app.dependencies.adapters.repositories;
    const correlation = createCorrelationMetadata({
      idempotencyKey: 'idem_seed-credentials',
      traceId: 'trc_seed-credentials',
    });

    await repositories.agents.create(
      createAgent({
        correlation,
        id: 'agt_credential-routes',
        lifecycleState: 'active',
        primaryChannelId: 'chn_credential-routes',
        provisioningState: 'active',
      }),
    );
    await repositories.channels.create(
      createChannel({
        agentId: 'agt_credential-routes',
        correlation,
        credentialId: 'crd_credential-routes',
        id: 'chn_credential-routes',
        state: 'active',
      }),
    );
    await repositories.credentials.createCredential({
      credentialRef: createCredentialRef({
        accessPolicyRef: 'github.api',
        agentId: 'agt_credential-routes',
        alias: 'github-token',
        correlation,
        createdAt: '2026-04-16T00:00:00.000Z',
        displayName: 'GitHub personal access token',
        encryptionKeyRef: 'platform://credential-envelope-key',
        id: 'crd_credential-routes',
        lastRotatedAt: '2026-04-16T00:00:00.000Z',
        provider: 'github',
        status: 'active',
        updatedAt: '2026-04-16T00:00:00.000Z',
      }),
      plaintext: 'ghp-route-test-token',
    });

    const listed = await app.inject({
      method: 'GET',
      url: '/api/admin/agents/agt_credential-routes/credentials',
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject([
      {
        alias: 'github-token',
        credentialId: 'crd_credential-routes',
        displayName: 'GitHub personal access token',
        provider: 'github',
        status: 'active',
      },
    ]);

    const revoked = await app.inject({
      method: 'POST',
      payload: {
        correlation: createCorrelation('idem_request-revoke-credential', 'trc_trace-revoke-credential'),
      },
      url: '/api/admin/agents/agt_credential-routes/credentials/crd_credential-routes/revoke',
    });

    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({
      credentialId: 'crd_credential-routes',
      status: 'revoked',
      revokedAt: expect.any(String),
    });

    const storedChannel = await repositories.channels.get(
      'agt_credential-routes',
      'chn_credential-routes',
    );
    expect(storedChannel?.value.credentialId).toBeUndefined();

    const listedAgain = await app.inject({
      method: 'GET',
      url: '/api/admin/agents/agt_credential-routes/credentials',
    });

    expect(listedAgain.statusCode).toBe(200);
    expect(listedAgain.json()).toMatchObject([
      {
        credentialId: 'crd_credential-routes',
        status: 'revoked',
      },
    ]);
  });

  it('executes trusted head turns in local-minimal mode', async () => {
    const config = createTestApiConfig();
    const app = buildApiServer(config);
    apps.push(app);
    const seeded = await seedHeadRuntimeRecords(app, {
      messageText: 'Please confirm the deployment status.',
    });

    const response = await app.inject({
      headers: {
        [INTERNAL_RUNTIME_AUTH_HEADER]: config.internalRuntime.authToken,
      },
      method: 'POST',
      payload: {
        agentId: seeded.agentId,
        correlation: {
          ...createCorrelation(),
          requestedBy: {
            displayName: 'Route Test User',
            id: 'telegram-user-1',
            kind: 'telegram',
          },
        },
        trigger: {
          kind: 'trusted_messages',
          channelId: seeded.channelId,
          inboundMessageIds: [seeded.inboundMessageId],
          readThroughMessageSequence: 1,
        },
      },
      url: '/api/internal/runtime/head/start-turn',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      effectSummary: {
        approvalRequested: false,
        credentialRequested: false,
        memoryOperationRequested: false,
        sandboxRequested: false,
        scheduleChangeRequested: false,
        taskRequested: false,
      },
      headTurn: {
        agentId: seeded.agentId,
        completionKind: 'reply',
        promptProfileVersion: 'head-base-v1',
        providerConversationId: expect.stringContaining('stub-conversation:'),
        providerRunId: expect.stringContaining('stub-run:'),
        triggerKind: 'trusted_messages',
        workingContextId: seeded.workingContextId,
      },
      replyDraft: {
        agentId: seeded.agentId,
        body: {
          text: 'Stubbed Head reply: Please confirm the deployment status.',
        },
        channelId: seeded.channelId,
        inReplyToInboundMessageId: seeded.inboundMessageId,
      },
      status: 'replied',
    });

    const storedContext = await app.dependencies.adapters.repositories.workingContexts.get(
      seeded.agentId,
      seeded.workingContextId,
    );
    expect(storedContext?.value.conversationCursor).toContain('stub-conversation:');
    expect(storedContext?.value.activeHeadTurnId).toBeNull();
    expect(storedContext?.value.latestProcessedSequence).toBe(1);
    expect(storedContext?.value.episodeTurnCount).toBe(1);
  });

  it('rejects untrusted inbound-message turns before model execution', async () => {
    const config = createTestApiConfig();
    const app = buildApiServer(config);
    apps.push(app);
    const seeded = await seedHeadRuntimeRecords(app, {
      messageText: 'Pretend this came from the user.',
      trusted: false,
    });

    const response = await app.inject({
      headers: {
        [INTERNAL_RUNTIME_AUTH_HEADER]: config.internalRuntime.authToken,
      },
      method: 'POST',
      payload: {
        agentId: seeded.agentId,
        correlation: {
          ...createCorrelation('idem_request-untrusted', 'trc_trace-untrusted'),
          requestedBy: {
            id: 'telegram-user-1',
            kind: 'telegram',
          },
        },
        trigger: {
          kind: 'trusted_messages',
          channelId: seeded.channelId,
          inboundMessageIds: [seeded.inboundMessageId],
          readThroughMessageSequence: 1,
        },
      },
      url: '/api/internal/runtime/head/start-turn',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      headTurn: {
        completionKind: 'rejected',
        failureCode: 'untrusted_message',
      },
      replyDraft: null,
      status: 'rejected',
    });
  });

  it('uses repository-driven capability summaries only when the user asks', async () => {
    const config = createTestApiConfig();
    const app = buildApiServer(config);
    apps.push(app);
    const seeded = await seedHeadRuntimeRecords(app, {
      messageText: 'What can you do right now?',
    });

    const response = await app.inject({
      headers: {
        [INTERNAL_RUNTIME_AUTH_HEADER]: config.internalRuntime.authToken,
      },
      method: 'POST',
      payload: {
        agentId: seeded.agentId,
        correlation: {
          ...createCorrelation('idem_request-capabilities', 'trc_trace-capabilities'),
          requestedBy: {
            id: 'telegram-user-1',
            kind: 'telegram',
          },
        },
        trigger: {
          kind: 'trusted_messages',
          channelId: seeded.channelId,
          inboundMessageIds: [seeded.inboundMessageId],
          readThroughMessageSequence: 1,
        },
      },
      url: '/api/internal/runtime/head/start-turn',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().replyDraft.body.text).toContain('Telegram direct messaging');
    expect(response.json().replyDraft.body.text).not.toContain('Sandbox shell execution');
  });

  it('marks running head turns as superseded and clears the active working-context pointer', async () => {
    const config = createTestApiConfig();
    const app = buildApiServer(config);
    apps.push(app);
    const seeded = await seedHeadRuntimeRecords(app, {
      messageText: 'Please confirm the deployment status.',
    });
    const repositories = app.dependencies.adapters.repositories;

    await repositories.execution.createHeadTurn({
      id: 'hdr_running-turn',
      recordType: 'head_turn',
      schemaVersion: 1,
      createdAt: '2026-04-13T06:00:00.000Z',
      updatedAt: '2026-04-13T06:00:00.000Z',
      correlation: createCorrelationMetadata({
        headTurnId: 'hdr_running-turn',
        idempotencyKey: 'idem_running-turn',
        traceId: 'trc_running-turn',
      }),
      agentId: seeded.agentId,
      workingContextId: seeded.workingContextId,
      state: 'running',
      triggerKind: 'trusted_messages',
      inboundMessageIds: [seeded.inboundMessageId],
      readThroughMessageSequence: 1,
      taskId: null,
      scheduleId: null,
      dueAt: null,
      claimedAt: '2026-04-13T06:00:00.000Z',
      startedAt: '2026-04-13T06:00:00.000Z',
      completedAt: null,
      staleCheckedAt: null,
      episodeLocalDate: '2026-04-13',
      episodeTurnIndex: 1,
      supersededBySequence: null,
      providerConversationId: 'stub-conversation:hdr_running-turn',
      providerRunId: 'stub-run:hdr_running-turn',
      promptProfileVersion: 'head-base-v1',
      completionKind: null,
      responseMessageId: null,
    });
    const storedContext = await repositories.workingContexts.get(seeded.agentId, seeded.workingContextId);
    await repositories.workingContexts.replace(
      {
        ...storedContext!.value,
        activeHeadTurnId: 'hdr_running-turn',
        activeHeadTurnStartedAt: '2026-04-13T06:00:00.000Z',
        activeHeadTurnReadThroughSequence: 1,
      },
      storedContext!.etag,
    );

    const response = await app.inject({
      headers: {
        [INTERNAL_RUNTIME_AUTH_HEADER]: config.internalRuntime.authToken,
      },
      method: 'POST',
      payload: {
        correlation: createCorrelation('idem_request-supersede', 'trc_trace-supersede'),
        headTurnId: 'hdr_running-turn',
        supersededBySequence: 2,
      },
      url: '/api/internal/runtime/head/supersede-turn',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'hdr_running-turn',
      state: 'superseded',
      supersededBySequence: 2,
    });

    const updatedContext = await repositories.workingContexts.get(
      seeded.agentId,
      seeded.workingContextId,
    );
    expect(updatedContext?.value.activeHeadTurnId).toBeNull();
  });

  it('rotates the active conversation when the stored episode date is stale', async () => {
    const config = createTestApiConfig();
    const app = buildApiServer(config);
    apps.push(app);
    const seeded = await seedHeadRuntimeRecords(app, {
      messageText: 'Please continue the deployment check.',
      workingContextOverrides: {
        conversationCursor: 'stale-conversation',
        episodeLocalDate: '2026-04-01',
        episodeTurnCount: 3,
      },
    });

    const response = await app.inject({
      headers: {
        [INTERNAL_RUNTIME_AUTH_HEADER]: config.internalRuntime.authToken,
      },
      method: 'POST',
      payload: {
        agentId: seeded.agentId,
        correlation: {
          ...createCorrelation('idem_request-rotate-date', 'trc_trace-rotate-date'),
          requestedBy: {
            id: 'telegram-user-1',
            kind: 'telegram',
          },
        },
        trigger: {
          kind: 'trusted_messages',
          channelId: seeded.channelId,
          inboundMessageIds: [seeded.inboundMessageId],
          readThroughMessageSequence: 1,
        },
      },
      url: '/api/internal/runtime/head/start-turn',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().headTurn.providerConversationId).toContain('stub-conversation:');
    expect(response.json().headTurn.providerConversationId).not.toBe('stale-conversation');

    const storedContext = await app.dependencies.adapters.repositories.workingContexts.get(
      seeded.agentId,
      seeded.workingContextId,
    );
    expect(storedContext?.value.episodeTurnCount).toBe(1);
    expect(storedContext?.value.conversationCursor).toContain('stub-conversation:');
  });

  it('rotates the active conversation after 20 authoritative turns', async () => {
    const sydneyToday = new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      month: '2-digit',
      timeZone: 'Australia/Sydney',
      year: 'numeric',
    })
      .formatToParts(new Date())
      .reduce<Record<string, string>>((parts, part) => {
        if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
          parts[part.type] = part.value;
        }

        return parts;
      }, {});
    const currentEpisodeDate = `${sydneyToday.year}-${sydneyToday.month}-${sydneyToday.day}`;

    const config = createTestApiConfig();
    const app = buildApiServer(config);
    apps.push(app);
    const seeded = await seedHeadRuntimeRecords(app, {
      messageText: 'Please continue the deployment check.',
      workingContextOverrides: {
        conversationCursor: 'turn-limit-conversation',
        episodeLocalDate: currentEpisodeDate,
        episodeTurnCount: 20,
      },
    });

    const response = await app.inject({
      headers: {
        [INTERNAL_RUNTIME_AUTH_HEADER]: config.internalRuntime.authToken,
      },
      method: 'POST',
      payload: {
        agentId: seeded.agentId,
        correlation: {
          ...createCorrelation('idem_request-rotate-count', 'trc_trace-rotate-count'),
          requestedBy: {
            id: 'telegram-user-1',
            kind: 'telegram',
          },
        },
        trigger: {
          kind: 'trusted_messages',
          channelId: seeded.channelId,
          inboundMessageIds: [seeded.inboundMessageId],
          readThroughMessageSequence: 1,
        },
      },
      url: '/api/internal/runtime/head/start-turn',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().headTurn.providerConversationId).toContain('stub-conversation:');
    expect(response.json().headTurn.providerConversationId).not.toBe('turn-limit-conversation');

    const storedContext = await app.dependencies.adapters.repositories.workingContexts.get(
      seeded.agentId,
      seeded.workingContextId,
    );
    expect(storedContext?.value.episodeTurnCount).toBe(1);
  });
});

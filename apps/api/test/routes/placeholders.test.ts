import { afterEach, describe, expect, it } from 'vitest';

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

describe('route implementations and remaining placeholders', () => {
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

  it('keeps internal runtime handlers thin and placeholder-backed', async () => {
    const config = createTestApiConfig();
    const app = buildApiServer(config);
    apps.push(app);

    const response = await app.inject({
      headers: {
        [INTERNAL_RUNTIME_AUTH_HEADER]: config.internalRuntime.authToken,
      },
      method: 'POST',
      payload: {
        agentId: 'agt_test-agent',
        correlation: createCorrelation(),
        inboundMessageIds: ['inm_message-1'],
        readThroughMessageSequence: 1,
        workingContextId: 'ctx_main-context',
      },
      url: '/api/internal/runtime/head/start-turn',
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({
      error: {
        code: 'not_implemented_yet',
        message: 'Head prompt-agent operations are reserved for Step 10.',
        retryable: false,
        traceId: 'trc_trace-1',
      },
    });
  });
});

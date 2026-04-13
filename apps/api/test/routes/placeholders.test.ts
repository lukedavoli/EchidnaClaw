import { afterEach, describe, expect, it } from 'vitest';

import { buildApiServer } from '../../src/app.js';
import { INTERNAL_RUNTIME_AUTH_HEADER } from '../../src/http/protection.js';
import { createTestApiConfig } from '../../src/testing/fixtures/api-config.js';

const apps: Array<ReturnType<typeof buildApiServer>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createCorrelation() {
  return {
    idempotencyKey: 'idem_request-1',
    traceId: 'trc_trace-1',
  };
}

describe('route skeleton placeholders', () => {
  it('keeps admin list agents behind the service placeholder', async () => {
    const app = buildApiServer(createTestApiConfig());
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/agents',
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({
      error: {
        code: 'not_implemented_yet',
        message: 'Agent persistence is reserved for Step 5.',
        retryable: false,
        traceId: response.headers['x-trace-id'],
      },
    });
  });

  it('validates route params before calling placeholder services', async () => {
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

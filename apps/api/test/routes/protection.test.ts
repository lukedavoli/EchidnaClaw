import { afterEach, describe, expect, it } from 'vitest';

import { buildApiServer } from '../../src/app.js';
import {
  INTERNAL_RUNTIME_AUTH_HEADER,
  TELEGRAM_WEBHOOK_SECRET_HEADER,
} from '../../src/http/protection.js';
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

describe('protected route groups', () => {
  it('rejects anonymous Telegram webhooks', async () => {
    const app = buildApiServer(createTestApiConfig());
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      payload: { update_id: 1 },
      url: '/api/channels/telegram/webhook',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: 'authentication_failed',
        message: 'Telegram webhook token is missing or invalid.',
        retryable: false,
        traceId: response.headers['x-trace-id'],
      },
    });
  });

  it('rejects anonymous internal runtime calls', async () => {
    const app = buildApiServer(createTestApiConfig());
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      payload: {},
      url: '/api/internal/runtime/head/start-turn',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: 'authentication_failed',
        message: 'Internal runtime token is missing or invalid.',
        retryable: false,
        traceId: response.headers['x-trace-id'],
      },
    });
  });

  it('returns a structured validation error once internal auth passes', async () => {
    const config = createTestApiConfig();
    const app = buildApiServer(config);
    apps.push(app);

    const response = await app.inject({
      headers: {
        [INTERNAL_RUNTIME_AUTH_HEADER]: config.internalRuntime.authToken,
      },
      method: 'POST',
      payload: {
        correlation: createCorrelation(),
      },
      url: '/api/internal/runtime/head/start-turn',
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['x-trace-id']).toBe(response.json().error.traceId);
    expect(response.json().error.code).toBe('validation_failed');
  });

  it('accepts the Telegram protection header and reaches the placeholder handler', async () => {
    const config = createTestApiConfig();
    const app = buildApiServer(config);
    apps.push(app);

    const response = await app.inject({
      headers: {
        [TELEGRAM_WEBHOOK_SECRET_HEADER]: config.telegram.webhookSecretToken,
      },
      method: 'POST',
      payload: {
        callback_query: {
          data: 'approval:apr_approval-1',
        },
        correlation: createCorrelation(),
        update_id: 1,
      },
      url: '/api/channels/telegram/webhook',
    });

    expect(response.statusCode).toBe(501);
    expect(response.json().error.code).toBe('not_implemented_yet');
    expect(response.json().error.traceId).toBe('trc_trace-1');
  });
});

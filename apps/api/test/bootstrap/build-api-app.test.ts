import { afterEach, describe, expect, it } from 'vitest';

import { buildApiServer } from '../../src/app.js';
import { createTestApiConfig } from '../../src/testing/fixtures/api-config.js';

const apps: Array<ReturnType<typeof buildApiServer>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('buildApiServer', () => {
  it('returns separate liveness and readiness responses', async () => {
    const app = buildApiServer(createTestApiConfig());
    apps.push(app);

    const healthResponse = await app.inject({ method: 'GET', url: '/healthz' });
    const readinessResponse = await app.inject({ method: 'GET', url: '/readyz' });

    expect(healthResponse.statusCode).toBe(200);
    expect(healthResponse.json()).toEqual({
      environment: 'test',
      runtimeMode: 'local-minimal',
      service: 'api',
      sharedCloudConfigured: false,
      status: 'ok',
    });

    expect(readinessResponse.statusCode).toBe(200);
    expect(readinessResponse.json()).toMatchObject({
      runtimeMode: 'local-minimal',
      service: 'api',
      status: 'ready',
    });
    expect(readinessResponse.json().dependencies.repositories).toEqual({
      description: 'Repository adapters use the in-memory suite for local-minimal development.',
      mode: 'in_memory',
      ready: true,
    });
  });

  it('allows browser requests from the configured web origin and the localhost variant', async () => {
    const app = buildApiServer(createTestApiConfig());
    apps.push(app);

    const configuredOriginResponse = await app.inject({
      headers: {
        origin: 'http://127.0.0.1:5173',
      },
      method: 'GET',
      url: '/healthz',
    });
    const localhostVariantResponse = await app.inject({
      headers: {
        origin: 'http://localhost:5173',
      },
      method: 'GET',
      url: '/healthz',
    });

    expect(configuredOriginResponse.headers['access-control-allow-origin']).toBe(
      'http://127.0.0.1:5173',
    );
    expect(localhostVariantResponse.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
  });
});

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
});

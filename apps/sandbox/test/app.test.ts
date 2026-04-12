import { afterEach, describe, expect, it } from 'vitest';

import { buildSandboxServer } from '../src/app.js';

const apps: Array<ReturnType<typeof buildSandboxServer>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('buildSandboxServer', () => {
  it('returns a health response', async () => {
    const app = buildSandboxServer({
      host: '127.0.0.1',
      logLevel: 'info',
      nodeEnv: 'test',
      port: 3002,
      runtimeMode: 'local-minimal',
      serviceName: 'sandbox',
      sharedCloud: null,
      webPublicBaseUrl: 'http://127.0.0.1:5173',
    });

    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      environment: 'test',
      runtimeMode: 'local-minimal',
      service: 'sandbox',
      sharedCloudConfigured: false,
      status: 'ok',
    });
  });
});

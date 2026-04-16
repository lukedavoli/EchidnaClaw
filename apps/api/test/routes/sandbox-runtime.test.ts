import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';
import { createAgent, createHandsRun, createTask } from '@echidna-claw/persistence';

import { buildSandboxServer } from '../../../sandbox/src/app.js';
import { buildApiServer } from '../../src/app.js';
import { INTERNAL_RUNTIME_AUTH_HEADER } from '../../src/http/protection.js';
import { createTestApiConfig } from '../../src/testing/fixtures/api-config.js';

const apiApps: Array<ReturnType<typeof buildApiServer>> = [];
const sandboxApps: Array<ReturnType<typeof buildSandboxServer>> = [];

afterEach(async () => {
  await Promise.all(apiApps.splice(0).map((app) => app.close()));
  await Promise.all(sandboxApps.splice(0).map((app) => app.close()));
});

function createSandboxTestConfig(internalAuthToken: string) {
  return {
    host: '127.0.0.1',
    logLevel: 'info' as const,
    nodeEnv: 'test' as const,
    port: 3002,
    runtimeMode: 'local-minimal' as const,
    serviceName: 'sandbox' as const,
    sharedCloud: null,
    webPublicBaseUrl: 'http://127.0.0.1:5173',
    internalAuthToken,
    cleanupTtlMs: 3600000,
    defaultOutputLimitBytes: 32768,
    defaultTimeoutMs: 10000,
    maxTimeoutMs: 60000,
    startupCleanupEnabled: true,
    workspaceRoot: resolve(tmpdir(), 'echidna-claw-tests', `api-sandbox-${Date.now()}`),
  };
}

async function startSandboxServer(internalAuthToken: string): Promise<string> {
  const sandboxApp = buildSandboxServer(createSandboxTestConfig(internalAuthToken));
  sandboxApps.push(sandboxApp);
  await sandboxApp.listen({ host: '127.0.0.1', port: 0 });
  const address = sandboxApp.server.address();

  if (address == null || typeof address === 'string') {
    throw new Error('Sandbox server did not expose a usable address.');
  }

  return `http://127.0.0.1:${address.port}`;
}

async function seedSandboxRuntimeRecords(app: ReturnType<typeof buildApiServer>) {
  const repositories = app.dependencies.adapters.repositories;

  await repositories.agents.create(
    createAgent({
      id: 'agt_sandbox-test',
      primaryChannelId: 'chn_sandbox-test',
    }),
  );
  await repositories.tasks.createTask(
    createTask({
      id: 'tsk_sandbox-test',
      agentId: 'agt_sandbox-test',
      activeTaskEnvelopeId: 'env_sandbox-test',
      currentRunJournalId: 'rjn_sandbox-test',
    }),
  );
  await repositories.execution.createHandsRun(
    createHandsRun({
      id: 'hnd_sandbox-test',
      agentId: 'agt_sandbox-test',
      taskEnvelopeId: 'env_sandbox-test',
      taskId: 'tsk_sandbox-test',
    }),
  );
}

describe('sandbox runtime routes', () => {
  it('creates, replays, executes, reads, and closes sandbox sessions through the API', async () => {
    const config = createTestApiConfig();
    const sandboxBaseUrl = await startSandboxServer(config.internalRuntime.authToken);
    const app = buildApiServer(
      createTestApiConfig({
        internalRuntime: {
          authToken: config.internalRuntime.authToken,
        },
        sandbox: {
          baseUrl: sandboxBaseUrl,
        },
      }),
    );
    apiApps.push(app);
    await seedSandboxRuntimeRecords(app);

    const createPayload = {
      agentId: 'agt_sandbox-test',
      taskId: 'tsk_sandbox-test',
      handsRunId: 'hnd_sandbox-test',
      policyName: 'standard',
      correlation: {
        traceId: 'trc_api-sandbox',
        idempotencyKey: 'idem_api-sandbox',
      },
    };

    const created = await app.inject({
      method: 'POST',
      url: '/api/internal/runtime/sandbox/sessions',
      headers: {
        [INTERNAL_RUNTIME_AUTH_HEADER]: config.internalRuntime.authToken,
      },
      payload: createPayload,
    });

    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      agentId: 'agt_sandbox-test',
      taskId: 'tsk_sandbox-test',
      state: 'created',
    });

    const replayed = await app.inject({
      method: 'POST',
      url: '/api/internal/runtime/sandbox/sessions',
      headers: {
        [INTERNAL_RUNTIME_AUTH_HEADER]: config.internalRuntime.authToken,
      },
      payload: createPayload,
    });

    expect(replayed.statusCode).toBe(200);
    expect(replayed.json().id).toBe(created.json().id);

    const executed = await app.inject({
      method: 'POST',
      url: `/api/internal/runtime/sandbox/sessions/${created.json().id}/commands`,
      headers: {
        [INTERNAL_RUNTIME_AUTH_HEADER]: config.internalRuntime.authToken,
      },
      payload: {
        command: 'echo hello',
        correlation: {
          traceId: 'trc_api-sandbox-command',
          idempotencyKey: 'idem_api-sandbox-command',
        },
      },
    });

    expect(executed.statusCode).toBe(200);
    expect(executed.json()).toMatchObject({
      sessionId: created.json().id,
      status: 'completed',
    });
    expect(executed.json().stdoutText).toContain('hello');

    const read = await app.inject({
      method: 'GET',
      url: `/api/internal/runtime/sandbox/sessions/${created.json().id}`,
      headers: {
        [INTERNAL_RUNTIME_AUTH_HEADER]: config.internalRuntime.authToken,
      },
    });

    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({
      id: created.json().id,
      commandCount: 1,
      workingDirectory: executed.json().resolvedWorkingDirectory,
    });

    const closed = await app.inject({
      method: 'POST',
      url: `/api/internal/runtime/sandbox/sessions/${created.json().id}/close`,
      headers: {
        [INTERNAL_RUNTIME_AUTH_HEADER]: config.internalRuntime.authToken,
      },
      payload: {
        reason: 'completed',
        correlation: {
          traceId: 'trc_api-sandbox-close',
          idempotencyKey: 'idem_api-sandbox-close',
        },
      },
    });

    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({
      id: created.json().id,
      state: 'completed',
      closedReason: 'completed',
    });
  });

  it('maps sandbox transport failures into dependency errors', async () => {
    const config = createTestApiConfig({
      sandbox: {
        baseUrl: 'http://127.0.0.1:9',
      },
    });
    const app = buildApiServer(config);
    apiApps.push(app);
    await seedSandboxRuntimeRecords(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/internal/runtime/sandbox/sessions',
      headers: {
        [INTERNAL_RUNTIME_AUTH_HEADER]: config.internalRuntime.authToken,
      },
      payload: {
        agentId: 'agt_sandbox-test',
        taskId: 'tsk_sandbox-test',
        handsRunId: 'hnd_sandbox-test',
        policyName: 'standard',
        correlation: {
          traceId: 'trc_api-sandbox-unavailable',
          idempotencyKey: 'idem_api-sandbox-unavailable',
        },
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: {
        code: 'dependency_unavailable',
      },
    });
  });
});

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildSandboxServer } from '../src/app.js';
import { INTERNAL_RUNTIME_AUTH_HEADER } from '../src/auth.js';

const apps: Array<ReturnType<typeof buildSandboxServer>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createSandboxTestConfig() {
  return {
    host: '127.0.0.1',
    logLevel: 'info' as const,
    nodeEnv: 'test' as const,
    port: 3002,
    runtimeMode: 'local-minimal' as const,
    serviceName: 'sandbox' as const,
    sharedCloud: null,
    webPublicBaseUrl: 'http://127.0.0.1:5173',
    internalAuthToken: 'local-internal-runtime-token',
    cleanupTtlMs: 3600000,
    defaultOutputLimitBytes: 32768,
    defaultTimeoutMs: 10000,
    maxTimeoutMs: 60000,
    startupCleanupEnabled: true,
    workspaceRoot: resolve(tmpdir(), 'echidna-claw-tests', `sandbox-${Date.now()}`),
  };
}

async function createSandboxSession(
  app: ReturnType<typeof buildSandboxServer>,
  config: ReturnType<typeof createSandboxTestConfig>,
  sessionId: string,
) {
  const correlationSuffix = sessionId.replace(/_/g, '-');
  return app.inject({
    method: 'POST',
    url: '/internal/sessions',
    headers: {
      [INTERNAL_RUNTIME_AUTH_HEADER]: config.internalAuthToken,
    },
    payload: {
      agentId: 'agt_test',
      taskId: 'tsk_test',
      handsRunId: 'hnd_test',
      sessionId,
      policyName: 'standard',
      packageAllowlistName: 'default-runtime-pnpm',
      credentialAliases: [],
      correlation: {
        traceId: `trc-${correlationSuffix}`.replace('trc-', 'trc_'),
        idempotencyKey: `idem-${correlationSuffix}`.replace('idem-', 'idem_'),
      },
    },
  });
}

async function executeSandboxCommand(
  app: ReturnType<typeof buildSandboxServer>,
  config: ReturnType<typeof createSandboxTestConfig>,
  sessionId: string,
  payload: Record<string, unknown>,
) {
  const correlationSuffix = sessionId.replace(/_/g, '-');
  return app.inject({
    method: 'POST',
    url: `/internal/sessions/${sessionId}/commands`,
    headers: {
      [INTERNAL_RUNTIME_AUTH_HEADER]: config.internalAuthToken,
    },
    payload: {
      correlation: {
        traceId: `trc_${correlationSuffix}-command`,
        idempotencyKey: `idem_${correlationSuffix}-command`,
      },
      ...payload,
    },
  });
}

describe('buildSandboxServer', () => {
  it('returns a health response', async () => {
    const app = buildSandboxServer(createSandboxTestConfig());

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
  }, 15000);

  it('cleans stale workspace contents on startup when cleanup is enabled', async () => {
    const config = createSandboxTestConfig();
    const staleDirectory = resolve(config.workspaceRoot, 'stale-session');
    mkdirSync(staleDirectory, { recursive: true });
    writeFileSync(resolve(staleDirectory, 'stale.txt'), 'stale');

    const app = buildSandboxServer(config);
    apps.push(app);

    await app.ready();

    expect(existsSync(config.workspaceRoot)).toBe(true);
    expect(existsSync(staleDirectory)).toBe(false);
  });

  it('creates, executes, and closes sandbox sessions through the internal routes', async () => {
    const config = createSandboxTestConfig();
    const app = buildSandboxServer(config);
    apps.push(app);

    const created = await createSandboxSession(app, config, 'sbx_test');

    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      id: 'sbx_test',
      state: 'created',
    });

    const executed = await executeSandboxCommand(app, config, 'sbx_test', {
      command: 'echo hello',
    });

    expect(executed.statusCode).toBe(200);
    expect(executed.json()).toMatchObject({
      sessionId: 'sbx_test',
      status: 'completed',
    });
    expect(executed.json().stdoutText).toContain('hello');

    const closed = await app.inject({
      method: 'POST',
      url: '/internal/sessions/sbx_test/close',
      headers: {
        [INTERNAL_RUNTIME_AUTH_HEADER]: config.internalAuthToken,
      },
      payload: {
        reason: 'completed',
        correlation: {
          traceId: 'trc_test-close',
          idempotencyKey: 'idem_test-close',
        },
      },
    });

    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({
      id: 'sbx_test',
      state: 'completed',
      closedReason: 'completed',
    });
    expect(existsSync(created.json().workspaceRoot)).toBe(false);
  }, 20000);

  it('enforces timeout, output, command, install, path, and host guardrails', async () => {
    const config = createSandboxTestConfig();
    const app = buildSandboxServer(config);
    apps.push(app);

    await createSandboxSession(app, config, 'sbx_limits');

    const timedOut = await executeSandboxCommand(app, config, 'sbx_limits', {
      command: 'node -e "setTimeout(() => {}, 2000)"',
      timeoutMs: 100,
    });
    expect(timedOut.statusCode).toBe(200);
    expect(timedOut.json()).toMatchObject({
      sessionId: 'sbx_limits',
      status: 'timed_out',
    });

    const truncated = await executeSandboxCommand(app, config, 'sbx_limits', {
      command: 'node -e "console.log(\'x\'.repeat(40000))"',
    });
    expect(truncated.statusCode).toBe(200);
    expect(truncated.json()).toMatchObject({
      sessionId: 'sbx_limits',
      status: 'completed',
      outputTruncated: true,
    });

    const deniedCommand = await executeSandboxCommand(app, config, 'sbx_limits', {
      command: 'docker ps',
    });
    expect(deniedCommand.statusCode).toBe(200);
    expect(deniedCommand.json()).toMatchObject({
      sessionId: 'sbx_limits',
      status: 'policy_denied',
      failureCode: 'command_denied',
    });

    const deniedInstall = await executeSandboxCommand(app, config, 'sbx_limits', {
      command: 'pnpm add left-pad',
    });
    expect(deniedInstall.statusCode).toBe(200);
    expect(deniedInstall.json()).toMatchObject({
      sessionId: 'sbx_limits',
      status: 'policy_denied',
      failureCode: 'package_not_allowlisted',
    });

    const deniedPath = await executeSandboxCommand(app, config, 'sbx_limits', {
      command: 'echo hello',
      workingDirectory: '../..',
    });
    expect(deniedPath.statusCode).toBe(200);
    expect(deniedPath.json()).toMatchObject({
      sessionId: 'sbx_limits',
      status: 'policy_denied',
      failureCode: 'filesystem_path_denied',
    });

    const deniedHost = await executeSandboxCommand(app, config, 'sbx_limits', {
      command: 'curl http://169.254.169.254/metadata/instance',
    });
    expect(deniedHost.statusCode).toBe(200);
    expect(deniedHost.json()).toMatchObject({
      sessionId: 'sbx_limits',
      status: 'policy_denied',
      failureCode: 'outbound_host_denied',
    });
  }, 20000);
});

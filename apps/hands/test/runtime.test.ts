import { describe, expect, it } from 'vitest';

import {
  createHandsRuntime,
  createHttpDispatchResult,
  parseHandsStartRunPayload,
  resolveHandsStartRunPayload,
} from '../src/runtime.js';

describe('createHandsRuntime', () => {
  it('builds a runtime description from config', () => {
    const runtime = createHandsRuntime({
      apiBaseUrl: 'http://127.0.0.1:4100',
      heartbeatIntervalMs: 30000,
      host: '127.0.0.1',
      internalAuthToken: 'runtime-test-token',
      internalSandboxBaseUrl: 'http://127.0.0.1:4200',
      livenessFile: 'C:/tmp/hands-liveness.json',
      logLevel: 'info',
      nodeEnv: 'test',
      port: 4300,
      runtimeMode: 'local-minimal',
      serviceName: 'hands',
      startRunPayload: null,
      sharedCloud: null,
      webPublicBaseUrl: 'http://127.0.0.1:5173',
      workerInstanceId: 'hands-runtime-test-worker',
    });

    expect(runtime).toMatchObject({
      apiBaseUrl: 'http://127.0.0.1:4100',
      heartbeatIntervalMs: 30000,
      host: '127.0.0.1',
      internalAuthToken: 'runtime-test-token',
      internalSandboxBaseUrl: 'http://127.0.0.1:4200',
      livenessFile: 'C:/tmp/hands-liveness.json',
      port: 4300,
      runtimeMode: 'local-minimal',
      serviceName: 'hands',
      startRunPayload: null,
      startupMessage: '[hands] ready in test (local-minimal) mode',
      workerInstanceId: 'hands-runtime-test-worker',
    });
  });

  it('parses one-shot payloads from the CLI and creates a dispatch response', () => {
    const payload = JSON.stringify({
      agentId: 'agt_runtime-test',
      attemptNumber: 3,
      correlation: {
        idempotencyKey: 'idem_hands-runtime-test',
        taskId: 'tsk_runtime-test',
        traceId: 'trc_hands-runtime-test',
      },
      dispatchIdempotencyKey: 'idem_hands-runtime-test',
      taskEnvelopeId: 'env_runtime-test',
      taskId: 'tsk_runtime-test',
    });

    expect(resolveHandsStartRunPayload(['--start-run-payload', payload])).toBe(payload);
    expect(resolveHandsStartRunPayload([`--start-run-payload=${payload}`])).toBe(payload);

    const parsed = parseHandsStartRunPayload(payload);
    expect(parsed).toMatchObject({
      agentId: 'agt_runtime-test',
      attemptNumber: 3,
      dispatchIdempotencyKey: 'idem_hands-runtime-test',
      taskEnvelopeId: 'env_runtime-test',
      taskId: 'tsk_runtime-test',
    });

    expect(createHttpDispatchResult(parsed, 'http')).toMatchObject({
      dispatchIdempotencyKey: 'idem_hands-runtime-test',
      dispatchMode: 'http',
      dispatchReference: 'idem_hands-runtime-test',
      taskEnvelopeId: 'env_runtime-test',
      taskId: 'tsk_runtime-test',
    });
  });
});

import { describe, expect, it } from 'vitest';

import { createHandsRuntime } from '../src/runtime.js';

describe('createHandsRuntime', () => {
  it('builds a runtime description from config', () => {
    const runtime = createHandsRuntime({
      heartbeatIntervalMs: 30000,
      livenessFile: 'C:/tmp/hands-liveness.json',
      logLevel: 'info',
      nodeEnv: 'test',
      runtimeMode: 'local-minimal',
      serviceName: 'hands',
      sharedCloud: null,
      webPublicBaseUrl: 'http://127.0.0.1:5173',
    });

    expect(runtime).toEqual({
      heartbeatIntervalMs: 30000,
      livenessFile: 'C:/tmp/hands-liveness.json',
      runtimeMode: 'local-minimal',
      serviceName: 'hands',
      startupMessage: '[hands] ready in test (local-minimal) mode',
    });
  });
});

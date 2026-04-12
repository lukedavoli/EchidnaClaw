import { describe, expect, it } from 'vitest';

import { createHandsRuntime } from '../src/runtime.js';

describe('createHandsRuntime', () => {
  it('builds a runtime description from config', () => {
    const runtime = createHandsRuntime({
      heartbeatIntervalMs: 30000,
      logLevel: 'info',
      nodeEnv: 'test',
      serviceName: 'hands',
    });

    expect(runtime).toEqual({
      heartbeatIntervalMs: 30000,
      serviceName: 'hands',
      startupMessage: '[hands] ready in test mode',
    });
  });
});

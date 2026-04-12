import { describe, expect, it } from 'vitest';

import { loadWebConfig } from '../src/browser.js';
import { loadApiConfig, loadHandsConfig, loadSandboxConfig } from '../src/index.js';

describe('config loaders', () => {
  it('applies API defaults', () => {
    expect(loadApiConfig({})).toMatchObject({
      serviceName: 'api',
      host: '127.0.0.1',
      port: 3001,
      nodeEnv: 'development',
      logLevel: 'info',
    });
  });

  it('rejects invalid sandbox ports', () => {
    expect(() =>
      loadSandboxConfig({
        ECHIDNA_SANDBOX_PORT: '70000',
      }),
    ).toThrow();
  });

  it('parses the hands heartbeat interval', () => {
    expect(
      loadHandsConfig({
        ECHIDNA_HANDS_HEARTBEAT_INTERVAL_MS: '45000',
      }).heartbeatIntervalMs,
    ).toBe(45000);
  });

  it('loads browser-safe web defaults', () => {
    expect(
      loadWebConfig({
        VITE_API_BASE_URL: 'http://127.0.0.1:3001',
        VITE_APP_TITLE: 'Control Plane',
      }),
    ).toEqual({
      apiBaseUrl: 'http://127.0.0.1:3001',
      appTitle: 'Control Plane',
    });
  });
});

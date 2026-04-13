import type { ApiConfig } from '@echidna-claw/config';

export function createTestApiConfig(
  overrides: Partial<ApiConfig> & {
    foundry?: Partial<ApiConfig['foundry']>;
    hands?: Partial<ApiConfig['hands']>;
    internalRuntime?: Partial<ApiConfig['internalRuntime']>;
    observability?: Partial<ApiConfig['observability']>;
    sandbox?: Partial<ApiConfig['sandbox']>;
    telegram?: Partial<ApiConfig['telegram']>;
  } = {},
): ApiConfig {
  const baseConfig: ApiConfig = {
    foundry: {
      defaultDeploymentName: 'gpt-5.4-mini',
    },
    hands: {
      jobTarget: 'local-hands-job',
    },
    host: '127.0.0.1',
    internalRuntime: {
      authToken: 'local-internal-runtime-token',
    },
    logLevel: 'info',
    nodeEnv: 'test',
    observability: {
      requestLoggingEnabled: false,
      trustProxy: false,
    },
    port: 3001,
    publicBaseUrl: 'http://127.0.0.1:3001',
    runtimeMode: 'local-minimal',
    sandbox: {
      baseUrl: 'http://127.0.0.1:3002',
    },
    serviceName: 'api',
    sharedCloud: null,
    telegram: {
      apiBaseUrl: 'https://api.telegram.org',
      requestTimeoutMs: 10000,
      webhookSecretToken: 'local-telegram-webhook-token',
    },
    webPublicBaseUrl: 'http://127.0.0.1:5173',
  };

  return {
    ...baseConfig,
    ...overrides,
    foundry: {
      ...baseConfig.foundry,
      ...overrides.foundry,
    },
    hands: {
      ...baseConfig.hands,
      ...overrides.hands,
    },
    internalRuntime: {
      ...baseConfig.internalRuntime,
      ...overrides.internalRuntime,
    },
    observability: {
      ...baseConfig.observability,
      ...overrides.observability,
    },
    sandbox: {
      ...baseConfig.sandbox,
      ...overrides.sandbox,
    },
    telegram: {
      ...baseConfig.telegram,
      ...overrides.telegram,
    },
  };
}

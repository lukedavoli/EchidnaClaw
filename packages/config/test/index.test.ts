import { describe, expect, it } from 'vitest';

import { loadApiConfig, loadHandsConfig, loadSandboxConfig } from '../src/index.js';

function createSharedCloudBaseEnv() {
  return {
    ECHIDNA_BLOB_STORAGE_ACCOUNT_URL: 'https://blob.example',
    ECHIDNA_BLOB_STORAGE_ARTIFACTS_CONTAINER: 'artifacts',
    ECHIDNA_BLOB_STORAGE_UPLOADS_CONTAINER: 'uploads',
    ECHIDNA_COSMOS_DB_CREDENTIAL_SCOPE: 'https://cosmos.azure.com/.default',
    ECHIDNA_COSMOS_DB_DATABASE_NAME: 'echidna',
    ECHIDNA_COSMOS_DB_ENDPOINT: 'https://cosmos.example',
    ECHIDNA_FOUNDRY_PROJECT_ENDPOINT: 'https://foundry.example',
    ECHIDNA_FOUNDRY_PROJECT_NAME: 'echidna-dev',
    ECHIDNA_KEY_VAULT_KEY_ID: 'key-id',
    ECHIDNA_KEY_VAULT_URI: 'https://vault.example',
    ECHIDNA_MONITOR_CONNECTION_STRING: 'InstrumentationKey=123',
    ECHIDNA_OPERATOR_OBJECT_ID: 'operator-123',
    ECHIDNA_RUNTIME_MODE: 'shared-cloud' as const,
    ECHIDNA_TRUSTED_USER_OBJECT_IDS: 'user-a,user-b',
    ECHIDNA_WEB_PUBLIC_BASE_URL: 'https://dev.echidna.example',
  };
}

describe('@echidna-claw/config', () => {
  it('defaults to local-minimal runtime settings with API-specific dependency defaults', () => {
    const config = loadApiConfig({});

    expect(config.runtimeMode).toBe('local-minimal');
    expect(config.sharedCloud).toBeNull();
    expect(config.webPublicBaseUrl).toBe('http://127.0.0.1:5173');
    expect(config.publicBaseUrl).toBe('http://127.0.0.1:3001');
    expect(config.head.debounceWindowMs).toBe(750);
    expect(config.telegram.webhookSecretToken).toBe('local-telegram-webhook-token');
    expect(config.internalRuntime.authToken).toBe('local-internal-runtime-token');
    expect(config.observability.requestLoggingEnabled).toBe(true);
  });

  it('fails fast when shared-cloud mode is selected without the required settings', () => {
    expect(() =>
      loadSandboxConfig({
        ECHIDNA_RUNTIME_MODE: 'shared-cloud',
      }),
    ).toThrow();
  });

  it('hydrates sandbox runtime defaults for local development', () => {
    const config = loadSandboxConfig({});

    expect(config.internalAuthToken).toBe('local-internal-runtime-token');
    expect(config.workspaceRoot).toContain('sandbox-workspaces');
    expect(config.defaultTimeoutMs).toBe(10000);
    expect(config.maxTimeoutMs).toBe(60000);
    expect(config.defaultOutputLimitBytes).toBe(32768);
    expect(config.startupCleanupEnabled).toBe(true);
  });

  it('fails fast when shared-cloud API startup is missing protected-route settings', () => {
    expect(() =>
      loadApiConfig({
        ...createSharedCloudBaseEnv(),
        ECHIDNA_API_PUBLIC_BASE_URL: 'https://api.echidna.example',
        ECHIDNA_FOUNDRY_DEFAULT_DEPLOYMENT_NAME: 'gpt-5.4-mini',
        ECHIDNA_HANDS_JOB_TARGET: 'hands-job-dev',
        ECHIDNA_SANDBOX_BASE_URL: 'https://sandbox.echidna.example',
        ECHIDNA_TELEGRAM_WEBHOOK_SECRET_TOKEN: 'telegram-secret',
      }),
    ).toThrow();
  });

  it('hydrates shared-cloud dependencies and API-specific config when the contract is complete', () => {
    const config = loadApiConfig({
      ...createSharedCloudBaseEnv(),
      ECHIDNA_API_PUBLIC_BASE_URL: 'https://api.echidna.example',
      ECHIDNA_FOUNDRY_DEFAULT_DEPLOYMENT_NAME: 'gpt-5.4-mini',
      ECHIDNA_HANDS_JOB_TARGET: 'hands-job-dev',
      ECHIDNA_INTERNAL_RUNTIME_AUTH_TOKEN: 'internal-secret',
      ECHIDNA_SANDBOX_BASE_URL: 'https://sandbox.echidna.example',
      ECHIDNA_TELEGRAM_WEBHOOK_SECRET_TOKEN: 'telegram-secret',
    });

    expect(config.runtimeMode).toBe('shared-cloud');
    expect(config.sharedCloud?.operatorIdentity.trustedUserObjectIds).toEqual(['user-a', 'user-b']);
    expect(config.publicBaseUrl).toBe('https://api.echidna.example');
    expect(config.sandbox.baseUrl).toBe('https://sandbox.echidna.example');
    expect(config.internalRuntime.authToken).toBe('internal-secret');
    expect(config.telegram.webhookSecretToken).toBe('telegram-secret');
  });

  it('keeps the hands defaults intact for local development', () => {
    const config = loadHandsConfig({});

    expect(config.runtimeMode).toBe('local-minimal');
    expect(config.livenessFile).toContain('hands-liveness.json');
  });
});

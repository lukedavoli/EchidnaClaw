import { describe, expect, it } from 'vitest';

import { loadApiConfig, loadHandsConfig, loadSandboxConfig } from '../src/index.js';

describe('@echidna-claw/config', () => {
  it('defaults to local-minimal runtime settings', () => {
    const config = loadApiConfig({});

    expect(config.runtimeMode).toBe('local-minimal');
    expect(config.sharedCloud).toBeNull();
    expect(config.webPublicBaseUrl).toBe('http://127.0.0.1:5173');
  });

  it('fails fast when shared-cloud mode is selected without the required settings', () => {
    expect(() =>
      loadSandboxConfig({
        ECHIDNA_RUNTIME_MODE: 'shared-cloud',
      }),
    ).toThrow();
  });

  it('hydrates shared-cloud dependencies when the shared-cloud contract is complete', () => {
    const config = loadHandsConfig({
      ECHIDNA_RUNTIME_MODE: 'shared-cloud',
      ECHIDNA_WEB_PUBLIC_BASE_URL: 'https://dev.echidna.example',
      ECHIDNA_OPERATOR_OBJECT_ID: 'operator-123',
      ECHIDNA_TRUSTED_USER_OBJECT_IDS: 'user-a,user-b',
      ECHIDNA_COSMOS_DB_ENDPOINT: 'https://cosmos.example',
      ECHIDNA_COSMOS_DB_DATABASE_NAME: 'echidna',
      ECHIDNA_COSMOS_DB_CREDENTIAL_SCOPE: 'https://cosmos.azure.com/.default',
      ECHIDNA_BLOB_STORAGE_ACCOUNT_URL: 'https://blob.example',
      ECHIDNA_BLOB_STORAGE_UPLOADS_CONTAINER: 'uploads',
      ECHIDNA_BLOB_STORAGE_ARTIFACTS_CONTAINER: 'artifacts',
      ECHIDNA_KEY_VAULT_URI: 'https://vault.example',
      ECHIDNA_KEY_VAULT_KEY_ID: 'key-id',
      ECHIDNA_FOUNDRY_PROJECT_NAME: 'echidna-dev',
      ECHIDNA_FOUNDRY_PROJECT_ENDPOINT: 'https://foundry.example',
      ECHIDNA_MONITOR_CONNECTION_STRING: 'InstrumentationKey=123',
    });

    expect(config.runtimeMode).toBe('shared-cloud');
    expect(config.sharedCloud?.operatorIdentity.trustedUserObjectIds).toEqual(['user-a', 'user-b']);
    expect(config.livenessFile).toContain('hands-liveness.json');
  });
});

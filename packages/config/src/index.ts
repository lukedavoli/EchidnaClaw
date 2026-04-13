import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

export { defaultRepositoryConfigPath, loadRepositoryConfig } from './repository.js';

const nodeEnvSchema = z.enum(['development', 'test', 'production']);
const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
const runtimeModeSchema = z.enum(['local-minimal', 'shared-cloud', 'cloud-deployed']);

const emptyStringToUndefined = (value: unknown): unknown => {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }

  return value;
};

const optionalNonEmptyStringSchema = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().min(1).optional(),
);
const optionalUrlSchema = z.preprocess(emptyStringToUndefined, z.string().trim().url().optional());
const requiredTrustedUserIdsSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') {
      return value;
    }

    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  },
  z.array(z.string().min(1)).min(1),
);

const sharedEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema.default('development'),
  LOG_LEVEL: logLevelSchema.default('info'),
  ECHIDNA_RUNTIME_MODE: runtimeModeSchema.default('local-minimal'),
  ECHIDNA_WEB_PUBLIC_BASE_URL: optionalUrlSchema,
  ECHIDNA_OPERATOR_OBJECT_ID: optionalNonEmptyStringSchema,
  ECHIDNA_TRUSTED_USER_OBJECT_IDS: z.string().default(''),
  ECHIDNA_COSMOS_DB_ENDPOINT: optionalUrlSchema,
  ECHIDNA_COSMOS_DB_DATABASE_NAME: optionalNonEmptyStringSchema,
  ECHIDNA_COSMOS_DB_CREDENTIAL_SCOPE: optionalNonEmptyStringSchema,
  ECHIDNA_BLOB_STORAGE_ACCOUNT_URL: optionalUrlSchema,
  ECHIDNA_BLOB_STORAGE_UPLOADS_CONTAINER: optionalNonEmptyStringSchema,
  ECHIDNA_BLOB_STORAGE_ARTIFACTS_CONTAINER: optionalNonEmptyStringSchema,
  ECHIDNA_KEY_VAULT_URI: optionalUrlSchema,
  ECHIDNA_KEY_VAULT_KEY_ID: optionalNonEmptyStringSchema,
  ECHIDNA_FOUNDRY_PROJECT_NAME: optionalNonEmptyStringSchema,
  ECHIDNA_FOUNDRY_PROJECT_ENDPOINT: optionalUrlSchema,
  ECHIDNA_MONITOR_CONNECTION_STRING: optionalNonEmptyStringSchema,
});

const apiEnvSchema = sharedEnvSchema.extend({
  ECHIDNA_API_HOST: z.string().min(1).default('127.0.0.1'),
  ECHIDNA_API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
});

const sandboxEnvSchema = sharedEnvSchema.extend({
  ECHIDNA_SANDBOX_HOST: z.string().min(1).default('127.0.0.1'),
  ECHIDNA_SANDBOX_PORT: z.coerce.number().int().min(1).max(65535).default(3002),
});

const handsEnvSchema = sharedEnvSchema.extend({
  ECHIDNA_HANDS_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1000).default(30000),
  ECHIDNA_HANDS_LIVENESS_FILE: optionalNonEmptyStringSchema,
});

const sharedCloudRuntimeEnvSchema = z.object({
  ECHIDNA_WEB_PUBLIC_BASE_URL: z.string().trim().url(),
  ECHIDNA_OPERATOR_OBJECT_ID: z.string().trim().min(1),
  ECHIDNA_TRUSTED_USER_OBJECT_IDS: requiredTrustedUserIdsSchema,
  ECHIDNA_COSMOS_DB_ENDPOINT: z.string().trim().url(),
  ECHIDNA_COSMOS_DB_DATABASE_NAME: z.string().trim().min(1),
  ECHIDNA_COSMOS_DB_CREDENTIAL_SCOPE: z.string().trim().min(1),
  ECHIDNA_BLOB_STORAGE_ACCOUNT_URL: z.string().trim().url(),
  ECHIDNA_BLOB_STORAGE_UPLOADS_CONTAINER: z.string().trim().min(1),
  ECHIDNA_BLOB_STORAGE_ARTIFACTS_CONTAINER: z.string().trim().min(1),
  ECHIDNA_KEY_VAULT_URI: z.string().trim().url(),
  ECHIDNA_KEY_VAULT_KEY_ID: z.string().trim().min(1),
  ECHIDNA_FOUNDRY_PROJECT_NAME: z.string().trim().min(1),
  ECHIDNA_FOUNDRY_PROJECT_ENDPOINT: z.string().trim().url(),
  ECHIDNA_MONITOR_CONNECTION_STRING: z.string().trim().min(1),
});

export type NodeEnv = z.infer<typeof nodeEnvSchema>;
export type LogLevel = z.infer<typeof logLevelSchema>;
export type RuntimeMode = z.infer<typeof runtimeModeSchema>;
export type SharedCloudDependenciesConfig = {
  blobStorage: {
    accountUrl: string;
    artifactsContainer: string;
    uploadsContainer: string;
  };
  cosmosDb: {
    credentialScope: string;
    databaseName: string;
    endpoint: string;
  };
  foundry: {
    projectEndpoint: string;
    projectName: string;
  };
  keyVault: {
    keyId: string;
    uri: string;
  };
  monitor: {
    connectionString: string;
  };
  operatorIdentity: {
    operatorObjectId: string;
    trustedUserObjectIds: string[];
  };
};
type BaseServiceConfig = {
  nodeEnv: NodeEnv;
  logLevel: LogLevel;
  runtimeMode: RuntimeMode;
  sharedCloud: SharedCloudDependenciesConfig | null;
  webPublicBaseUrl: string;
};
export type ApiConfig = BaseServiceConfig & {
  serviceName: 'api';
  host: string;
  port: number;
};
export type SandboxConfig = BaseServiceConfig & {
  serviceName: 'sandbox';
  host: string;
  port: number;
};
export type HandsConfig = BaseServiceConfig & {
  serviceName: 'hands';
  heartbeatIntervalMs: number;
  livenessFile: string;
};

type EnvSource = Record<string, string | undefined>;
let envHydrated = false;

function hydrateRepositoryEnv(): void {
  if (envHydrated) {
    return;
  }

  const packageRoot = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(packageRoot, '../../..');

  for (const fileName of ['.env', '.env.local']) {
    const filePath = resolve(repoRoot, fileName);

    if (existsSync(filePath)) {
      loadDotenv({ path: filePath });
    }
  }

  envHydrated = true;
}

function parseEnv<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  source: EnvSource,
): z.output<TSchema> {
  return schema.parse(source);
}

function resolveDefaultHandsLivenessFile(): string {
  return resolve(tmpdir(), 'echidna-claw', 'hands-liveness.json');
}

function loadSharedCloudDependencies(
  source: EnvSource,
  runtimeMode: RuntimeMode,
): SharedCloudDependenciesConfig | null {
  if (runtimeMode === 'local-minimal') {
    return null;
  }

  const env = parseEnv(sharedCloudRuntimeEnvSchema, source);

  return {
    blobStorage: {
      accountUrl: env.ECHIDNA_BLOB_STORAGE_ACCOUNT_URL,
      artifactsContainer: env.ECHIDNA_BLOB_STORAGE_ARTIFACTS_CONTAINER,
      uploadsContainer: env.ECHIDNA_BLOB_STORAGE_UPLOADS_CONTAINER,
    },
    cosmosDb: {
      credentialScope: env.ECHIDNA_COSMOS_DB_CREDENTIAL_SCOPE,
      databaseName: env.ECHIDNA_COSMOS_DB_DATABASE_NAME,
      endpoint: env.ECHIDNA_COSMOS_DB_ENDPOINT,
    },
    foundry: {
      projectEndpoint: env.ECHIDNA_FOUNDRY_PROJECT_ENDPOINT,
      projectName: env.ECHIDNA_FOUNDRY_PROJECT_NAME,
    },
    keyVault: {
      keyId: env.ECHIDNA_KEY_VAULT_KEY_ID,
      uri: env.ECHIDNA_KEY_VAULT_URI,
    },
    monitor: {
      connectionString: env.ECHIDNA_MONITOR_CONNECTION_STRING,
    },
    operatorIdentity: {
      operatorObjectId: env.ECHIDNA_OPERATOR_OBJECT_ID,
      trustedUserObjectIds: env.ECHIDNA_TRUSTED_USER_OBJECT_IDS,
    },
  };
}

function buildBaseServiceConfig(
  source: EnvSource,
  env: z.output<typeof sharedEnvSchema>,
): BaseServiceConfig {
  return {
    logLevel: env.LOG_LEVEL,
    nodeEnv: env.NODE_ENV,
    runtimeMode: env.ECHIDNA_RUNTIME_MODE,
    sharedCloud: loadSharedCloudDependencies(source, env.ECHIDNA_RUNTIME_MODE),
    webPublicBaseUrl:
      env.ECHIDNA_WEB_PUBLIC_BASE_URL ??
      (env.ECHIDNA_RUNTIME_MODE === 'local-minimal' ? 'http://127.0.0.1:5173' : ''),
  };
}

export function loadApiConfig(source: EnvSource = process.env): ApiConfig {
  if (source === process.env) {
    hydrateRepositoryEnv();
  }

  const env = parseEnv(apiEnvSchema, source);
  return {
    ...buildBaseServiceConfig(source, env),
    serviceName: 'api',
    host: env.ECHIDNA_API_HOST,
    port: env.ECHIDNA_API_PORT,
  };
}

export function loadSandboxConfig(source: EnvSource = process.env): SandboxConfig {
  if (source === process.env) {
    hydrateRepositoryEnv();
  }

  const env = parseEnv(sandboxEnvSchema, source);
  return {
    ...buildBaseServiceConfig(source, env),
    serviceName: 'sandbox',
    host: env.ECHIDNA_SANDBOX_HOST,
    port: env.ECHIDNA_SANDBOX_PORT,
  };
}

export function loadHandsConfig(source: EnvSource = process.env): HandsConfig {
  if (source === process.env) {
    hydrateRepositoryEnv();
  }

  const env = parseEnv(handsEnvSchema, source);
  return {
    ...buildBaseServiceConfig(source, env),
    serviceName: 'hands',
    heartbeatIntervalMs: env.ECHIDNA_HANDS_HEARTBEAT_INTERVAL_MS,
    livenessFile: env.ECHIDNA_HANDS_LIVENESS_FILE ?? resolveDefaultHandsLivenessFile(),
  };
}

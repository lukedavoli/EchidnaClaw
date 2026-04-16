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

const stringToBoolean = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }

  switch (value.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true;
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return false;
    default:
      return value;
  }
};

const optionalNonEmptyStringSchema = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().min(1).optional(),
);
const optionalUrlSchema = z.preprocess(emptyStringToUndefined, z.string().trim().url().optional());
const optionalBooleanSchema = z.preprocess(stringToBoolean, z.boolean().optional());
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
  ECHIDNA_API_PUBLIC_BASE_URL: optionalUrlSchema,
  ECHIDNA_API_TRUST_PROXY: optionalBooleanSchema,
  ECHIDNA_API_REQUEST_LOGGING_ENABLED: optionalBooleanSchema,
  ECHIDNA_HEAD_DEBOUNCE_WINDOW_MS: z.coerce.number().int().min(0).default(750),
  ECHIDNA_SANDBOX_BASE_URL: optionalUrlSchema,
  ECHIDNA_HANDS_BASE_URL: optionalUrlSchema,
  ECHIDNA_HANDS_JOB_TARGET: optionalNonEmptyStringSchema,
  ECHIDNA_FOUNDRY_DEFAULT_DEPLOYMENT_NAME: optionalNonEmptyStringSchema,
  ECHIDNA_TELEGRAM_API_BASE_URL: optionalUrlSchema,
  ECHIDNA_TELEGRAM_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10000),
  ECHIDNA_TELEGRAM_WEBHOOK_SECRET_TOKEN: optionalNonEmptyStringSchema,
  ECHIDNA_INTERNAL_RUNTIME_AUTH_TOKEN: optionalNonEmptyStringSchema,
});

const sandboxEnvSchema = sharedEnvSchema.extend({
  ECHIDNA_SANDBOX_HOST: z.string().min(1).default('127.0.0.1'),
  ECHIDNA_SANDBOX_PORT: z.coerce.number().int().min(1).max(65535).default(3002),
  ECHIDNA_INTERNAL_RUNTIME_AUTH_TOKEN: optionalNonEmptyStringSchema,
  ECHIDNA_SANDBOX_WORKSPACE_ROOT: optionalNonEmptyStringSchema,
  ECHIDNA_SANDBOX_CLEANUP_TTL_MS: z.coerce.number().int().positive().default(3600000),
  ECHIDNA_SANDBOX_DEFAULT_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  ECHIDNA_SANDBOX_MAX_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  ECHIDNA_SANDBOX_DEFAULT_OUTPUT_LIMIT_BYTES: z.coerce.number().int().positive().default(32768),
  ECHIDNA_SANDBOX_STARTUP_CLEANUP_ENABLED: optionalBooleanSchema,
});

const handsEnvSchema = sharedEnvSchema.extend({
  ECHIDNA_API_PUBLIC_BASE_URL: optionalUrlSchema,
  ECHIDNA_HANDS_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1000).default(30000),
  ECHIDNA_HANDS_HOST: z.string().min(1).default('127.0.0.1'),
  ECHIDNA_HANDS_LIVENESS_FILE: optionalNonEmptyStringSchema,
  ECHIDNA_HANDS_PORT: z.coerce.number().int().min(1).max(65535).default(3003),
  ECHIDNA_HANDS_START_RUN_PAYLOAD: optionalNonEmptyStringSchema,
  ECHIDNA_HANDS_WORKER_INSTANCE_ID: optionalNonEmptyStringSchema,
  ECHIDNA_INTERNAL_RUNTIME_AUTH_TOKEN: optionalNonEmptyStringSchema,
  ECHIDNA_SANDBOX_BASE_URL: optionalUrlSchema,
});

const schedulerEnvSchema = sharedEnvSchema.extend({
  ECHIDNA_API_PUBLIC_BASE_URL: optionalUrlSchema,
  ECHIDNA_INTERNAL_RUNTIME_AUTH_TOKEN: optionalNonEmptyStringSchema,
  ECHIDNA_SCHEDULER_MAX_BATCH_SIZE: z.coerce.number().int().positive().default(50),
  ECHIDNA_SCHEDULER_MAX_PASSES: z.coerce.number().int().positive().default(1),
  ECHIDNA_SCHEDULER_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15000),
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

const apiRemoteDependencyEnvSchema = z.object({
  ECHIDNA_API_PUBLIC_BASE_URL: z.string().trim().url(),
  ECHIDNA_SANDBOX_BASE_URL: z.string().trim().url(),
  ECHIDNA_HANDS_JOB_TARGET: z.string().trim().min(1),
  ECHIDNA_FOUNDRY_DEFAULT_DEPLOYMENT_NAME: z.string().trim().min(1),
  ECHIDNA_TELEGRAM_WEBHOOK_SECRET_TOKEN: z.string().trim().min(1),
  ECHIDNA_INTERNAL_RUNTIME_AUTH_TOKEN: z.string().trim().min(1),
});

const sandboxRemoteDependencyEnvSchema = z.object({
  ECHIDNA_INTERNAL_RUNTIME_AUTH_TOKEN: z.string().trim().min(1),
});

const schedulerRemoteDependencyEnvSchema = z.object({
  ECHIDNA_API_PUBLIC_BASE_URL: z.string().trim().url(),
  ECHIDNA_INTERNAL_RUNTIME_AUTH_TOKEN: z.string().trim().min(1),
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
export type ApiDependencyConfig = {
  foundry: {
    defaultDeploymentName: string;
  };
  head: {
    debounceWindowMs: number;
  };
  hands: {
    baseUrl: string;
    jobTarget: string;
  };
  internalRuntime: {
    authToken: string;
  };
  observability: {
    requestLoggingEnabled: boolean;
    trustProxy: boolean;
  };
  publicBaseUrl: string;
  sandbox: {
    baseUrl: string;
  };
  telegram: {
    apiBaseUrl: string;
    requestTimeoutMs: number;
    webhookSecretToken: string;
  };
};
type BaseServiceConfig = {
  nodeEnv: NodeEnv;
  logLevel: LogLevel;
  runtimeMode: RuntimeMode;
  sharedCloud: SharedCloudDependenciesConfig | null;
  webPublicBaseUrl: string;
};
export type ApiConfig = BaseServiceConfig &
  ApiDependencyConfig & {
    serviceName: 'api';
    host: string;
    port: number;
  };
export type SandboxConfig = BaseServiceConfig & {
  serviceName: 'sandbox';
  host: string;
  internalAuthToken: string;
  cleanupTtlMs: number;
  defaultOutputLimitBytes: number;
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  port: number;
  startupCleanupEnabled: boolean;
  workspaceRoot: string;
};
export type HandsConfig = BaseServiceConfig & {
  apiBaseUrl: string;
  internalSandboxBaseUrl: string;
  serviceName: 'hands';
  heartbeatIntervalMs: number;
  host: string;
  internalAuthToken: string;
  livenessFile: string;
  port: number;
  startRunPayload: string | null;
  workerInstanceId: string;
};
export type SchedulerConfig = BaseServiceConfig & {
  apiBaseUrl: string;
  internalAuthToken: string;
  maxBatchSize: number;
  maxPasses: number;
  requestTimeoutMs: number;
  serviceName: 'scheduler';
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

function resolveDefaultSandboxWorkspaceRoot(): string {
  return resolve(tmpdir(), 'echidna-claw', 'sandbox-workspaces');
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

function resolveApiDependencyConfig(
  source: EnvSource,
  env: z.output<typeof apiEnvSchema>,
): ApiDependencyConfig {
  const defaults = {
    foundry: {
      defaultDeploymentName: env.ECHIDNA_FOUNDRY_DEFAULT_DEPLOYMENT_NAME ?? 'gpt-5.4-mini',
    },
    head: {
      debounceWindowMs: env.ECHIDNA_HEAD_DEBOUNCE_WINDOW_MS,
    },
    hands: {
      baseUrl: env.ECHIDNA_HANDS_BASE_URL ?? 'http://127.0.0.1:3003',
      jobTarget: env.ECHIDNA_HANDS_JOB_TARGET ?? 'local-hands-job',
    },
    internalRuntime: {
      authToken: env.ECHIDNA_INTERNAL_RUNTIME_AUTH_TOKEN ?? 'local-internal-runtime-token',
    },
    observability: {
      requestLoggingEnabled:
        env.ECHIDNA_API_REQUEST_LOGGING_ENABLED ?? env.NODE_ENV !== 'test',
      trustProxy: env.ECHIDNA_API_TRUST_PROXY ?? env.ECHIDNA_RUNTIME_MODE !== 'local-minimal',
    },
    publicBaseUrl:
      env.ECHIDNA_API_PUBLIC_BASE_URL ??
      `http://${env.ECHIDNA_API_HOST}:${env.ECHIDNA_API_PORT}`,
    sandbox: {
      baseUrl: env.ECHIDNA_SANDBOX_BASE_URL ?? 'http://127.0.0.1:3002',
    },
    telegram: {
      apiBaseUrl: env.ECHIDNA_TELEGRAM_API_BASE_URL ?? 'https://api.telegram.org',
      requestTimeoutMs: env.ECHIDNA_TELEGRAM_REQUEST_TIMEOUT_MS,
      webhookSecretToken:
        env.ECHIDNA_TELEGRAM_WEBHOOK_SECRET_TOKEN ?? 'local-telegram-webhook-token',
    },
  } satisfies ApiDependencyConfig;

  if (env.ECHIDNA_RUNTIME_MODE === 'local-minimal') {
    return defaults;
  }

  const remoteEnv = parseEnv(apiRemoteDependencyEnvSchema, source);

  return {
    foundry: {
      defaultDeploymentName: remoteEnv.ECHIDNA_FOUNDRY_DEFAULT_DEPLOYMENT_NAME,
    },
    head: defaults.head,
    hands: {
      baseUrl: defaults.hands.baseUrl,
      jobTarget: remoteEnv.ECHIDNA_HANDS_JOB_TARGET,
    },
    internalRuntime: {
      authToken: remoteEnv.ECHIDNA_INTERNAL_RUNTIME_AUTH_TOKEN,
    },
    observability: defaults.observability,
    publicBaseUrl: remoteEnv.ECHIDNA_API_PUBLIC_BASE_URL,
    sandbox: {
      baseUrl: remoteEnv.ECHIDNA_SANDBOX_BASE_URL,
    },
    telegram: {
      apiBaseUrl: defaults.telegram.apiBaseUrl,
      requestTimeoutMs: defaults.telegram.requestTimeoutMs,
      webhookSecretToken: remoteEnv.ECHIDNA_TELEGRAM_WEBHOOK_SECRET_TOKEN,
    },
  };
}

export function loadApiConfig(source: EnvSource = process.env): ApiConfig {
  if (source === process.env) {
    hydrateRepositoryEnv();
  }

  const env = parseEnv(apiEnvSchema, source);
  return {
    ...buildBaseServiceConfig(source, env),
    ...resolveApiDependencyConfig(source, env),
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
  const internalAuthToken =
    env.ECHIDNA_RUNTIME_MODE === 'local-minimal'
      ? env.ECHIDNA_INTERNAL_RUNTIME_AUTH_TOKEN ?? 'local-internal-runtime-token'
      : parseEnv(sandboxRemoteDependencyEnvSchema, source).ECHIDNA_INTERNAL_RUNTIME_AUTH_TOKEN;

  return {
    ...buildBaseServiceConfig(source, env),
    serviceName: 'sandbox',
    host: env.ECHIDNA_SANDBOX_HOST,
    internalAuthToken,
    cleanupTtlMs: env.ECHIDNA_SANDBOX_CLEANUP_TTL_MS,
    defaultOutputLimitBytes: env.ECHIDNA_SANDBOX_DEFAULT_OUTPUT_LIMIT_BYTES,
    defaultTimeoutMs: env.ECHIDNA_SANDBOX_DEFAULT_TIMEOUT_MS,
    maxTimeoutMs: env.ECHIDNA_SANDBOX_MAX_TIMEOUT_MS,
    port: env.ECHIDNA_SANDBOX_PORT,
    startupCleanupEnabled: env.ECHIDNA_SANDBOX_STARTUP_CLEANUP_ENABLED ?? true,
    workspaceRoot: env.ECHIDNA_SANDBOX_WORKSPACE_ROOT ?? resolveDefaultSandboxWorkspaceRoot(),
  };
}

export function loadHandsConfig(source: EnvSource = process.env): HandsConfig {
  if (source === process.env) {
    hydrateRepositoryEnv();
  }

  const env = parseEnv(handsEnvSchema, source);
  const internalAuthToken =
    env.ECHIDNA_RUNTIME_MODE === 'local-minimal'
      ? env.ECHIDNA_INTERNAL_RUNTIME_AUTH_TOKEN ?? 'local-internal-runtime-token'
      : parseEnv(sandboxRemoteDependencyEnvSchema, source).ECHIDNA_INTERNAL_RUNTIME_AUTH_TOKEN;

  return {
    ...buildBaseServiceConfig(source, env),
    apiBaseUrl: env.ECHIDNA_API_PUBLIC_BASE_URL ?? 'http://127.0.0.1:3001',
    internalSandboxBaseUrl: env.ECHIDNA_SANDBOX_BASE_URL ?? 'http://127.0.0.1:3002',
    serviceName: 'hands',
    heartbeatIntervalMs: env.ECHIDNA_HANDS_HEARTBEAT_INTERVAL_MS,
    host: env.ECHIDNA_HANDS_HOST,
    internalAuthToken,
    livenessFile: env.ECHIDNA_HANDS_LIVENESS_FILE ?? resolveDefaultHandsLivenessFile(),
    port: env.ECHIDNA_HANDS_PORT,
    startRunPayload: env.ECHIDNA_HANDS_START_RUN_PAYLOAD ?? null,
    workerInstanceId:
      env.ECHIDNA_HANDS_WORKER_INSTANCE_ID ??
      `hands-${env.ECHIDNA_RUNTIME_MODE}-${env.ECHIDNA_HANDS_PORT}`,
  };
}

export function loadSchedulerConfig(source: EnvSource = process.env): SchedulerConfig {
  if (source === process.env) {
    hydrateRepositoryEnv();
  }

  const env = parseEnv(schedulerEnvSchema, source);
  const remoteEnv =
    env.ECHIDNA_RUNTIME_MODE === 'local-minimal'
      ? null
      : parseEnv(schedulerRemoteDependencyEnvSchema, source);

  return {
    ...buildBaseServiceConfig(source, env),
    apiBaseUrl:
      remoteEnv?.ECHIDNA_API_PUBLIC_BASE_URL ??
      env.ECHIDNA_API_PUBLIC_BASE_URL ??
      'http://127.0.0.1:3001',
    internalAuthToken:
      remoteEnv?.ECHIDNA_INTERNAL_RUNTIME_AUTH_TOKEN ??
      env.ECHIDNA_INTERNAL_RUNTIME_AUTH_TOKEN ??
      'local-internal-runtime-token',
    maxBatchSize: env.ECHIDNA_SCHEDULER_MAX_BATCH_SIZE,
    maxPasses: env.ECHIDNA_SCHEDULER_MAX_PASSES,
    requestTimeoutMs: env.ECHIDNA_SCHEDULER_REQUEST_TIMEOUT_MS,
    serviceName: 'scheduler',
  };
}

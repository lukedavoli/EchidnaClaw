import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const nodeEnvSchema = z.enum(['development', 'test', 'production']);
const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);

const sharedEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema.default('development'),
  LOG_LEVEL: logLevelSchema.default('info'),
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
});

export type NodeEnv = z.infer<typeof nodeEnvSchema>;
export type LogLevel = z.infer<typeof logLevelSchema>;
export type ApiConfig = {
  serviceName: 'api';
  nodeEnv: NodeEnv;
  logLevel: LogLevel;
  host: string;
  port: number;
};
export type SandboxConfig = {
  serviceName: 'sandbox';
  nodeEnv: NodeEnv;
  logLevel: LogLevel;
  host: string;
  port: number;
};
export type HandsConfig = {
  serviceName: 'hands';
  nodeEnv: NodeEnv;
  logLevel: LogLevel;
  heartbeatIntervalMs: number;
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
      loadDotenv({ override: true, path: filePath });
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

export function loadApiConfig(source: EnvSource = process.env): ApiConfig {
  if (source === process.env) {
    hydrateRepositoryEnv();
  }

  const env = parseEnv(apiEnvSchema, source);
  return {
    serviceName: 'api',
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
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
    serviceName: 'sandbox',
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
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
    serviceName: 'hands',
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    heartbeatIntervalMs: env.ECHIDNA_HANDS_HEARTBEAT_INTERVAL_MS,
  };
}

import { loadApiConfig, type ApiConfig } from '@echidna-claw/config';

type EnvSource = Record<string, string | undefined>;

export type ApiRuntimeConfig = ApiConfig;

export function loadApiRuntimeConfig(source: EnvSource = process.env): ApiRuntimeConfig {
  return loadApiConfig(source);
}

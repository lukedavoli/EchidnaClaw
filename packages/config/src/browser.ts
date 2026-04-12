import { z } from 'zod';

const runtimeModeSchema = z.enum(['local-minimal', 'shared-cloud', 'cloud-deployed']);

const webEnvSchema = z.object({
  VITE_API_BASE_URL: z.string().url().default('http://127.0.0.1:3001'),
  VITE_APP_BASE_URL: z.string().url().default('http://127.0.0.1:5173'),
  VITE_APP_TITLE: z.string().min(1).default('EchidnaClaw Control Plane'),
  VITE_RUNTIME_MODE: runtimeModeSchema.default('local-minimal'),
});

export type WebConfig = {
  apiBaseUrl: string;
  appBaseUrl: string;
  appTitle: string;
  runtimeMode: z.infer<typeof runtimeModeSchema>;
};

type EnvSource = Record<string, string | undefined>;

export function loadWebConfig(source: EnvSource): WebConfig {
  const env = webEnvSchema.parse(source);

  return {
    apiBaseUrl: env.VITE_API_BASE_URL,
    appBaseUrl: env.VITE_APP_BASE_URL,
    appTitle: env.VITE_APP_TITLE,
    runtimeMode: env.VITE_RUNTIME_MODE,
  };
}

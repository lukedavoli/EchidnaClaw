import { z } from 'zod';

const webEnvSchema = z.object({
  VITE_API_BASE_URL: z.string().url().default('http://127.0.0.1:3001'),
  VITE_APP_TITLE: z.string().min(1).default('EchidnaClaw Control Plane'),
});

export type WebConfig = {
  apiBaseUrl: string;
  appTitle: string;
};

type EnvSource = Record<string, string | undefined>;

export function loadWebConfig(source: EnvSource): WebConfig {
  const env = webEnvSchema.parse(source);

  return {
    apiBaseUrl: env.VITE_API_BASE_URL,
    appTitle: env.VITE_APP_TITLE,
  };
}

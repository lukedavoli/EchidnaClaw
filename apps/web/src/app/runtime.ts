import { loadWebConfig } from '@echidna-claw/config/browser';

export const webConfig = loadWebConfig(import.meta.env as Record<string, string | undefined>);

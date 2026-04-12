import process from 'node:process';

import { loadApiConfig } from '@echidna-claw/config';

import { buildApiServer } from './app.js';

const config = loadApiConfig();
const app = buildApiServer(config);

try {
  await app.listen({ host: config.host, port: config.port });
  console.log(`[${config.serviceName}] listening on http://${config.host}:${config.port}`);
} catch (error) {
  console.error('[api] failed to start', error);
  process.exit(1);
}

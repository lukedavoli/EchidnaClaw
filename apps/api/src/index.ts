import process from 'node:process';

import { loadApiRuntimeConfig } from './config/api-runtime-config.js';
import { buildApiServer } from './app.js';

const config = loadApiRuntimeConfig();
const app = buildApiServer(config);

try {
  await app.listen({ host: config.host, port: config.port });
  console.log(`[${config.serviceName}] listening on ${config.publicBaseUrl}`);
} catch (error) {
  console.error('[api] failed to start', error);
  process.exit(1);
}

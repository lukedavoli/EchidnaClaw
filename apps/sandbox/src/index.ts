import process from 'node:process';

import { loadSandboxConfig } from '@echidna-claw/config';

import { buildSandboxServer } from './app.js';

const config = loadSandboxConfig();
const app = buildSandboxServer(config);

try {
  await app.listen({ host: config.host, port: config.port });
  console.log(`[${config.serviceName}] listening on http://${config.host}:${config.port}`);
} catch (error) {
  console.error('[sandbox] failed to start', error);
  process.exit(1);
}

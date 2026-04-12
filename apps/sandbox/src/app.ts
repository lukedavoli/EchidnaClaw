import Fastify, { type FastifyInstance } from 'fastify';

import { loadSandboxConfig, type SandboxConfig } from '@echidna-claw/config';

export function buildSandboxServer(config: SandboxConfig = loadSandboxConfig()): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/healthz', async () => ({
    environment: config.nodeEnv,
    service: config.serviceName,
    status: 'ok',
  }));

  return app;
}

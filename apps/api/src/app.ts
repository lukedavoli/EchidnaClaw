import Fastify, { type FastifyInstance } from 'fastify';

import { loadApiConfig, type ApiConfig } from '@echidna-claw/config';

export function buildApiServer(config: ApiConfig = loadApiConfig()): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/healthz', async () => ({
    environment: config.nodeEnv,
    service: config.serviceName,
    status: 'ok',
  }));

  return app;
}

import type { FastifyInstance } from 'fastify';

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/healthz', async () => ({
    environment: app.dependencies.config.nodeEnv,
    runtimeMode: app.dependencies.config.runtimeMode,
    service: app.dependencies.config.serviceName,
    sharedCloudConfigured: app.dependencies.config.sharedCloud != null,
    status: 'ok',
  }));
}

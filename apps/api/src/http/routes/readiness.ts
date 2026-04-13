import type { FastifyInstance } from 'fastify';

export function registerReadinessRoutes(app: FastifyInstance): void {
  app.get('/readyz', async (_request, reply) => {
    const statusCode = app.dependencies.readiness.ready ? 200 : 503;

    reply.code(statusCode);

    return {
      dependencies: app.dependencies.readiness.dependencies,
      runtimeMode: app.dependencies.readiness.runtimeMode,
      service: app.dependencies.config.serviceName,
      status: app.dependencies.readiness.ready ? 'ready' : 'not_ready',
    };
  });
}

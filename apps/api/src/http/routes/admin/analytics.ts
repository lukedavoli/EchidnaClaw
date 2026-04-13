import type { FastifyInstance } from 'fastify';

export function registerAdminAnalyticsRoutes(app: FastifyInstance): void {
  app.get('/analytics/overview', async () =>
    app.dependencies.services.webControlPlaneService.getAnalyticsOverview(),
  );
}

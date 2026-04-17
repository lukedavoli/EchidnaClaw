import { agentIdSchema, analyticsWindowSchema } from '@echidna-claw/contracts';
import type { FastifyInstance } from 'fastify';

function parseWindow(value: unknown) {
  return value == null ? undefined : analyticsWindowSchema.parse(value);
}

export function registerAdminAnalyticsRoutes(app: FastifyInstance): void {
  app.get('/analytics/overview', async (request) => {
    const query = (request.query ?? {}) as {
      window?: string;
    };

    return app.dependencies.services.webControlPlaneService.getAnalyticsOverview(
      parseWindow(query.window),
    );
  });

  app.get('/analytics/agents/:agentId', async (request) => {
    const params = request.params as { agentId?: string };
    const query = (request.query ?? {}) as {
      window?: string;
    };

    return app.dependencies.services.webControlPlaneService.getAgentAnalytics(
      agentIdSchema.parse(params.agentId),
      parseWindow(query.window),
    );
  });

  app.get('/analytics/series', async (request) => {
    const query = (request.query ?? {}) as {
      agentId?: string;
      window?: string;
    };

    return app.dependencies.services.webControlPlaneService.getAnalyticsSeries({
      ...(query.agentId ? { agentId: agentIdSchema.parse(query.agentId) } : {}),
      ...(query.window ? { window: analyticsWindowSchema.parse(query.window) } : {}),
    });
  });
}

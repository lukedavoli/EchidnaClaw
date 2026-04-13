import {
  agentIdSchema,
  correlationMetadataSchema,
  webCreateAgentRequestSchema,
} from '@echidna-claw/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { bindRequestCorrelation } from '../../request-context.js';

const agentIdParamsSchema = z.object({ agentId: agentIdSchema }).strict();
const routeBodySchema = z.object({ correlation: correlationMetadataSchema }).strict();

export function registerAdminAgentRoutes(app: FastifyInstance): void {
  app.get('/agents', async () => app.dependencies.services.webControlPlaneService.listAgents());

  app.get('/agents/:agentId', async (request) => {
    const params = agentIdParamsSchema.parse(request.params) as z.infer<typeof agentIdParamsSchema>;
    return app.dependencies.services.webControlPlaneService.getAgent(params.agentId);
  });

  app.post('/agents', async (request, reply) => {
    const body = webCreateAgentRequestSchema.parse(request.body);
    bindRequestCorrelation(request, { correlation: body.correlation });

    reply.code(201);
    return app.dependencies.services.webControlPlaneService.createAgent(body);
  });

  app.post('/agents/:agentId/soft-delete', async (request) => {
    const params = agentIdParamsSchema.parse(request.params) as z.infer<typeof agentIdParamsSchema>;
    const body = routeBodySchema.parse(request.body) as z.infer<typeof routeBodySchema>;
    bindRequestCorrelation(request, {
      agentId: params.agentId,
      correlation: body.correlation,
    });

    return app.dependencies.services.webControlPlaneService.softDeleteAgent({
      agentId: params.agentId,
      correlation: body.correlation,
    });
  });

  app.post('/agents/:agentId/restore', async (request) => {
    const params = agentIdParamsSchema.parse(request.params) as z.infer<typeof agentIdParamsSchema>;
    const body = routeBodySchema.parse(request.body) as z.infer<typeof routeBodySchema>;
    bindRequestCorrelation(request, {
      agentId: params.agentId,
      correlation: body.correlation,
    });

    return app.dependencies.services.webControlPlaneService.restoreAgent({
      agentId: params.agentId,
      correlation: body.correlation,
    });
  });

  app.post('/agents/:agentId/provisioning/retry', async (request) => {
    const params = agentIdParamsSchema.parse(request.params) as z.infer<typeof agentIdParamsSchema>;
    const body = routeBodySchema.parse(request.body) as z.infer<typeof routeBodySchema>;
    bindRequestCorrelation(request, {
      agentId: params.agentId,
      correlation: body.correlation,
    });

    return app.dependencies.services.webControlPlaneService.retryAgentProvisioning({
      agentId: params.agentId,
      correlation: body.correlation,
    });
  });
}

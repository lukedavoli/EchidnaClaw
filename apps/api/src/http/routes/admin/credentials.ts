import {
  agentIdSchema,
  correlationMetadataSchema,
  credentialIdSchema,
} from '@echidna-claw/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { bindRequestCorrelation } from '../../request-context.js';

const listCredentialParamsSchema = z.object({ agentId: agentIdSchema }).strict();
const revokeCredentialParamsSchema = z
  .object({
    agentId: agentIdSchema,
    credentialId: credentialIdSchema,
  })
  .strict();
const revokeCredentialBodySchema = z.object({ correlation: correlationMetadataSchema }).strict();

export function registerAdminCredentialRoutes(app: FastifyInstance): void {
  app.get('/agents/:agentId/credentials', async (request) => {
    const params = listCredentialParamsSchema.parse(request.params);
    return app.dependencies.services.webControlPlaneService.listCredentials(params.agentId);
  });

  app.post('/agents/:agentId/credentials/:credentialId/revoke', async (request) => {
    const params = revokeCredentialParamsSchema.parse(request.params);
    const body = revokeCredentialBodySchema.parse(request.body);
    bindRequestCorrelation(request, {
      agentId: params.agentId,
      correlation: body.correlation,
    });

    return app.dependencies.services.webControlPlaneService.revokeCredential({
      agentId: params.agentId,
      correlation: body.correlation,
      credentialId: params.credentialId,
    });
  });
}

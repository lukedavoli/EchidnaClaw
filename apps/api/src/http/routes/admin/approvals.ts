import { approvalIdSchema } from '@echidna-claw/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const approvalParamsSchema = z.object({ approvalId: approvalIdSchema }).strict();

export function registerAdminApprovalRoutes(app: FastifyInstance): void {
  app.get('/approvals/:approvalId', async (request) => {
    const params = approvalParamsSchema.parse(request.params);
    const state = await app.dependencies.services.webControlPlaneService.getApprovalState(
      params.approvalId,
    );

    return {
      approvalId: params.approvalId,
      state,
    };
  });
}

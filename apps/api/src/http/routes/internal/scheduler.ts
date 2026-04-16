import { schedulerProcessDueWorkRequestSchema } from '@echidna-claw/contracts';
import type { FastifyInstance } from 'fastify';

import { bindRequestCorrelation } from '../../request-context.js';

export function registerSchedulerRuntimeRoutes(app: FastifyInstance): void {
  app.post('/scheduler/process-due-work', async (request) => {
    const body = schedulerProcessDueWorkRequestSchema.parse(request.body);
    bindRequestCorrelation(request, { correlation: body.correlation });
    return app.dependencies.services.schedulerRuntimeService.processDueWork(body);
  });
}

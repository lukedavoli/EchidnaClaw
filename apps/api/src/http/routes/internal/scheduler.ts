import { schedulerMaterializeDueSchedulesRequestSchema } from '@echidna-claw/contracts';
import type { FastifyInstance } from 'fastify';

import { bindRequestCorrelation } from '../../request-context.js';

export function registerSchedulerRuntimeRoutes(app: FastifyInstance): void {
  app.post('/scheduler/materialize-due-schedules', async (request) => {
    const body = schedulerMaterializeDueSchedulesRequestSchema.parse(request.body);
    bindRequestCorrelation(request, { correlation: body.correlation });
    return app.dependencies.services.schedulerRuntimeService.materializeDueSchedules(body);
  });
}

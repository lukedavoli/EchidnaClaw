import {
  headStartTurnRequestSchema,
  headSupersedeTurnRequestSchema,
} from '@echidna-claw/contracts';
import type { FastifyInstance } from 'fastify';

import { bindRequestCorrelation } from '../../request-context.js';

export function registerHeadRuntimeRoutes(app: FastifyInstance): void {
  app.post('/head/start-turn', async (request) => {
    const body = headStartTurnRequestSchema.parse(request.body);
    bindRequestCorrelation(request, {
      agentId: body.agentId,
      correlation: body.correlation,
    });

    return app.dependencies.services.headRuntimeService.startTurn(body);
  });

  app.post('/head/supersede-turn', async (request) => {
    const body = headSupersedeTurnRequestSchema.parse(request.body);
    bindRequestCorrelation(request, { correlation: body.correlation });
    return app.dependencies.services.headRuntimeService.supersedeTurn(body);
  });
}

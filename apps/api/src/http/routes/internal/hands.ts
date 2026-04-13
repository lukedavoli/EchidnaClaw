import {
  handsReleaseForUserRequestSchema,
  handsStartRunRequestSchema,
} from '@echidna-claw/contracts';
import type { FastifyInstance } from 'fastify';

import { bindRequestCorrelation } from '../../request-context.js';

export function registerHandsRuntimeRoutes(app: FastifyInstance): void {
  app.post('/hands/start-run', async (request) => {
    const body = handsStartRunRequestSchema.parse(request.body);
    bindRequestCorrelation(request, { correlation: body.correlation });
    return app.dependencies.services.handsRuntimeService.startRun(body);
  });

  app.post('/hands/release-for-user', async (request) => {
    const body = handsReleaseForUserRequestSchema.parse(request.body);
    bindRequestCorrelation(request, { correlation: body.correlation });
    return app.dependencies.services.handsRuntimeService.releaseForUser(body);
  });
}

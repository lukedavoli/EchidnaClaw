import { sandboxCreateSessionRequestSchema } from '@echidna-claw/contracts';
import type { FastifyInstance } from 'fastify';

import { bindRequestCorrelation } from '../../request-context.js';

export function registerSandboxRuntimeRoutes(app: FastifyInstance): void {
  app.post('/sandbox/sessions', async (request) => {
    const body = sandboxCreateSessionRequestSchema.parse(request.body);
    bindRequestCorrelation(request, { correlation: body.correlation });
    return app.dependencies.services.sandboxRuntimeService.createSession(body);
  });
}

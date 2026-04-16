import {
  sandboxCloseSessionRequestSchema,
  sandboxCreateSessionRequestSchema,
  sandboxExecuteCommandRequestSchema,
  sandboxSessionIdSchema,
} from '@echidna-claw/contracts';
import type { FastifyInstance } from 'fastify';

import { bindRequestCorrelation } from '../../request-context.js';

export function registerSandboxRuntimeRoutes(app: FastifyInstance): void {
  app.post('/sandbox/sessions', async (request) => {
    const body = sandboxCreateSessionRequestSchema.parse(request.body);
    bindRequestCorrelation(request, { correlation: body.correlation });
    return app.dependencies.services.sandboxRuntimeService.createSession(body);
  });

  app.get('/sandbox/sessions/:sessionId', async (request) => {
    const params = request.params as { sessionId?: string };
    const sessionId = sandboxSessionIdSchema.parse(params.sessionId);
    return app.dependencies.services.sandboxRuntimeService.getSession(sessionId);
  });

  app.post('/sandbox/sessions/:sessionId/commands', async (request) => {
    const params = request.params as { sessionId?: string };
    const body =
      typeof request.body === 'object' && request.body != null
        ? (request.body as Record<string, unknown>)
        : {};
    const payload = sandboxExecuteCommandRequestSchema.parse({
      ...body,
      sessionId: params.sessionId,
    });
    bindRequestCorrelation(request, { correlation: payload.correlation });
    return app.dependencies.services.sandboxRuntimeService.executeCommand(payload);
  });

  app.post('/sandbox/sessions/:sessionId/close', async (request) => {
    const params = request.params as { sessionId?: string };
    const body =
      typeof request.body === 'object' && request.body != null
        ? (request.body as Record<string, unknown>)
        : {};
    const payload = sandboxCloseSessionRequestSchema.parse({
      ...body,
      sessionId: params.sessionId,
    });
    bindRequestCorrelation(request, { correlation: payload.correlation });
    return app.dependencies.services.sandboxRuntimeService.closeSession(payload);
  });
}

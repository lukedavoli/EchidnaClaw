import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import { loadSandboxConfig, type SandboxConfig } from '@echidna-claw/config';
import {
  sandboxCloseSessionRequestSchema,
  sandboxExecuteCommandRequestSchema,
  sandboxProvisionSessionRequestSchema,
  sandboxSessionIdSchema,
} from '@echidna-claw/contracts';

import { assertSandboxAuthorized } from './auth.js';
import {
  NoopSandboxCredentialResolver,
  type SandboxCredentialResolver,
} from './credentials.js';
import { SandboxHttpError } from './errors.js';
import { LocalSandboxRuntime } from './runtime.js';

export function buildSandboxServer(
  config: SandboxConfig = loadSandboxConfig(),
  options: {
    credentialResolver?: SandboxCredentialResolver;
  } = {},
): FastifyInstance {
  const app = Fastify({ logger: false });
  const runtime = new LocalSandboxRuntime(
    config,
    options.credentialResolver ?? new NoopSandboxCredentialResolver(),
  );

  app.addHook('onReady', async () => {
    await runtime.cleanupWorkspaceRoot();
  });

  app.addHook('onError', async (_request, _reply, error) => {
    if (error instanceof Error) {
      console.error(`[sandbox] ${error.name}: ${error.message}`);
    }
  });

  app.setErrorHandler(async (error, _request, reply) => {
    if (error instanceof ZodError) {
      const issueMessage = error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      reply.code(400).send({
        error: {
          code: 'validation_failed',
          message: issueMessage,
          retryable: false,
          traceId: 'sandbox',
        },
      });
      return;
    }

    if (error instanceof SandboxHttpError) {
      reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          retryable: false,
          traceId: 'sandbox',
        },
      });
      return;
    }

    reply.code(500).send({
      error: {
        code: 'internal_error',
        message: error instanceof Error ? error.message : 'Sandbox request failed unexpectedly.',
        retryable: false,
        traceId: 'sandbox',
      },
    });
  });

  app.get('/healthz', async () => ({
    environment: config.nodeEnv,
    runtimeMode: config.runtimeMode,
    service: config.serviceName,
    sharedCloudConfigured: config.sharedCloud != null,
    status: 'ok',
  }));

  app.register(
    async (runtimeApp) => {
      runtimeApp.addHook('onRequest', async (request) => {
        assertSandboxAuthorized(request, config);
      });

      runtimeApp.post('/sessions', async (request) => {
        const body = sandboxProvisionSessionRequestSchema.parse(request.body);
        return runtime.createSession(body);
      });

      runtimeApp.get('/sessions/:sessionId', async (request) => {
        const params = request.params as { sessionId?: string };
        const sessionId = sandboxSessionIdSchema.parse(params.sessionId);
        return runtime.getSession(sessionId);
      });

      runtimeApp.post('/sessions/:sessionId/commands', async (request) => {
        const params = request.params as { sessionId?: string };
        const body =
          typeof request.body === 'object' && request.body != null
            ? (request.body as Record<string, unknown>)
            : {};
        const payload = sandboxExecuteCommandRequestSchema.parse({
          ...body,
          sessionId: params.sessionId,
        });
        return runtime.executeCommand(payload);
      });

      runtimeApp.post('/sessions/:sessionId/close', async (request) => {
        const params = request.params as { sessionId?: string };
        const body =
          typeof request.body === 'object' && request.body != null
            ? (request.body as Record<string, unknown>)
            : {};
        const payload = sandboxCloseSessionRequestSchema.parse({
          ...body,
          sessionId: params.sessionId,
        });
        return runtime.closeSession(payload);
      });
    },
    { prefix: '/internal' },
  );

  return app;
}

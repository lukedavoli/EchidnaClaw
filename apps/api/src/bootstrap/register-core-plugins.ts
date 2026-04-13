import { getRequestContext } from '@echidna-claw/observability';
import type { FastifyInstance } from 'fastify';

import { toErrorResponse } from '../http/errors.js';
import { getRequestTraceId, initializeRequestContext } from '../http/request-context.js';

export function registerCorePlugins(app: FastifyInstance): void {
  app.decorateRequest('requestContext', null);

  app.addHook('onRequest', async (request) => {
    initializeRequestContext(request);

    if (app.dependencies.config.observability.requestLoggingEnabled) {
      app.dependencies.appLogger.info('http.request.started', {
        method: request.method,
        route: request.routeOptions.url,
      });
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-trace-id', getRequestTraceId(request));
    return payload;
  });

  app.addHook('onResponse', async (request, reply) => {
    if (!app.dependencies.config.observability.requestLoggingEnabled) {
      return;
    }

    const context = getRequestContext() ?? request.requestContext;
    const startedAt = context?.startedAt == null ? Date.now() : Date.parse(context.startedAt);

    app.dependencies.appLogger.info('http.request.completed', {
      durationMs: Math.max(Date.now() - startedAt, 0),
      method: request.method,
      route: request.routeOptions.url,
      statusCode: reply.statusCode,
    });
  });

  app.setErrorHandler(async (error, request, reply) => {
    const traceId = getRequestTraceId(request);
    const response = toErrorResponse(error, traceId);

    app.dependencies.appLogger.error('http.request.failed', {
      code: response.body.error.code,
      message: response.body.error.message,
      route: request.routeOptions.url,
      statusCode: response.statusCode,
    });

    reply.code(response.statusCode).send(response.body);
  });
}

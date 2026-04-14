import cors from '@fastify/cors';
import { getRequestContext } from '@echidna-claw/observability';
import type { FastifyInstance } from 'fastify';

import { toErrorResponse } from '../http/errors.js';
import { getRequestTraceId, initializeRequestContext } from '../http/request-context.js';

function createAllowedWebOrigins(webPublicBaseUrl: string): Set<string> {
  const allowedOrigins = new Set<string>([webPublicBaseUrl]);
  const configuredUrl = new URL(webPublicBaseUrl);

  if (configuredUrl.hostname === '127.0.0.1') {
    configuredUrl.hostname = 'localhost';
    allowedOrigins.add(configuredUrl.toString().replace(/\/$/, ''));
  } else if (configuredUrl.hostname === 'localhost') {
    configuredUrl.hostname = '127.0.0.1';
    allowedOrigins.add(configuredUrl.toString().replace(/\/$/, ''));
  }

  return allowedOrigins;
}

export function registerCorePlugins(app: FastifyInstance): void {
  app.decorateRequest('requestContext', null);
  const allowedOrigins = createAllowedWebOrigins(app.dependencies.config.webPublicBaseUrl);

  app.register(cors, {
    origin(origin, callback) {
      if (origin == null || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
  });

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

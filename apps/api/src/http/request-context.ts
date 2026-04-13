import { randomUUID } from 'node:crypto';

import type { ActorKind, CorrelationMetadata } from '@echidna-claw/contracts';
import {
  getRequestContext,
  setRequestContext,
  updateRequestContext,
  type RequestContext,
} from '@echidna-claw/observability';
import type { FastifyRequest } from 'fastify';

function createTraceId(): string {
  return `trc_${randomUUID().replace(/-/g, '').toLowerCase()}`;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function classifyRouteGroup(pathname: string): string {
  if (pathname === '/healthz') {
    return 'health';
  }

  if (pathname === '/readyz') {
    return 'readiness';
  }

  if (pathname.startsWith('/api/admin/')) {
    return 'admin';
  }

  if (pathname.startsWith('/api/channels/telegram/')) {
    return 'telegram';
  }

  if (pathname.startsWith('/api/internal/outbound-messages/')) {
    return 'outbound-messages';
  }

  if (pathname.startsWith('/api/internal/runtime/scheduler/')) {
    return 'scheduler-runtime';
  }

  if (pathname.startsWith('/api/internal/runtime/')) {
    return 'internal-runtime';
  }

  return 'unknown';
}

function classifyActorKind(routeGroup: string): ActorKind {
  switch (routeGroup) {
    case 'admin':
      return 'operator';
    case 'scheduler-runtime':
      return 'scheduler';
    case 'telegram':
      return 'telegram';
    case 'internal-runtime':
    case 'outbound-messages':
      return 'system';
    default:
      return 'system';
  }
}

export function initializeRequestContext(request: FastifyRequest): RequestContext {
  const routeGroup = classifyRouteGroup(request.routeOptions.url ?? request.url);
  const traceId = firstHeaderValue(request.headers['x-trace-id'])?.trim() || createTraceId();
  const actorId =
    firstHeaderValue(request.headers['x-operator-id'])?.trim() ||
    firstHeaderValue(request.headers['x-echidna-actor-id'])?.trim();
  const context: RequestContext = {
    actorKind: classifyActorKind(routeGroup),
    method: request.method,
    requestId: request.id,
    routeGroup,
    startedAt: new Date().toISOString(),
    traceId,
    url: request.url,
  };

  if (actorId != null && actorId.length > 0) {
    context.actorId = actorId;
  }

  setRequestContext(context);

  request.requestContext = context;
  return context;
}

export function bindRequestCorrelation(
  request: FastifyRequest,
  options: {
    actorId?: string;
    agentId?: string;
    correlation?: CorrelationMetadata;
  },
): RequestContext | undefined {
  const patch: Partial<RequestContext> = {
    traceId: options.correlation?.traceId ?? getRequestTraceId(request),
  };

  if (options.correlation != null) {
    patch.correlation = options.correlation;
  }

  if (options.agentId != null) {
    patch.agentId = options.agentId;
  }

  const actorId = options.actorId ?? options.correlation?.requestedBy?.id;

  if (actorId != null) {
    patch.actorId = actorId;
  }

  const nextContext = updateRequestContext(patch);

  if (nextContext != null) {
    request.requestContext = nextContext;
  }

  return nextContext;
}

export function getRequestTraceId(request: FastifyRequest): string {
  return getRequestContext()?.traceId ?? request.requestContext?.traceId ?? 'unknown-trace';
}

import { AsyncLocalStorage } from 'node:async_hooks';

import type { ActorKind, CorrelationMetadata } from '@echidna-claw/contracts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;
export type RequestContext = {
  actorId?: string;
  actorKind: ActorKind;
  agentId?: string;
  correlation?: CorrelationMetadata;
  method?: string;
  requestId: string;
  routeGroup: string;
  startedAt: string;
  traceId: string;
  url?: string;
};
export type LogEntry = {
  bindings: LogFields;
  fields: LogFields;
  level: LogLevel;
  message: string;
  requestContext?: RequestContext;
  service: string;
  timestamp: string;
};
export type LogSink = (entry: LogEntry) => void;
export type Logger = {
  child(bindings?: LogFields): Logger;
  debug(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
};
export type LoggerFactory = {
  createLogger(bindings?: LogFields): Logger;
};

const requestContextStore = new AsyncLocalStorage<RequestContext>();
const logLevelPriority: Record<LogLevel, number> = {
  debug: 10,
  error: 40,
  info: 20,
  warn: 30,
};
const redactedFieldPattern = /authorization|password|secret|token/i;

function defaultLogSink(entry: LogEntry): void {
  const target = entry.level === 'error' || entry.level === 'warn' ? console.error : console.log;
  target(JSON.stringify(entry));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function redactUnknownValue(value: unknown, keyName?: string): unknown {
  if (keyName != null && redactedFieldPattern.test(keyName)) {
    return '[REDACTED]';
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactUnknownValue(entry));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactUnknownValue(entryValue, entryKey),
    ]),
  );
}

function createLogger(
  serviceName: string,
  level: LogLevel,
  sink: LogSink,
  bindings: LogFields = {},
): Logger {
  return {
    child(childBindings: LogFields = {}) {
      return createLogger(serviceName, level, sink, { ...bindings, ...childBindings });
    },
    debug(message, fields) {
      emitLogEntry(serviceName, level, sink, 'debug', message, bindings, fields);
    },
    error(message, fields) {
      emitLogEntry(serviceName, level, sink, 'error', message, bindings, fields);
    },
    info(message, fields) {
      emitLogEntry(serviceName, level, sink, 'info', message, bindings, fields);
    },
    warn(message, fields) {
      emitLogEntry(serviceName, level, sink, 'warn', message, bindings, fields);
    },
  };
}

function emitLogEntry(
  serviceName: string,
  configuredLevel: LogLevel,
  sink: LogSink,
  entryLevel: LogLevel,
  message: string,
  bindings: LogFields,
  fields: LogFields = {},
): void {
  if (logLevelPriority[entryLevel] < logLevelPriority[configuredLevel]) {
    return;
  }

  const context = getRequestContext();
  const entry: LogEntry = {
    bindings: redactLogFields(bindings),
    fields: redactLogFields({
      ...fields,
      correlation: correlationMetadataToLogFields(context?.correlation),
    }),
    level: entryLevel,
    message,
    service: serviceName,
    timestamp: new Date().toISOString(),
  };

  if (context != null) {
    entry.requestContext = context;
  }

  sink(entry);
}

export function createLoggerFactory(options: {
  level: LogLevel;
  serviceName: string;
  sink?: LogSink;
}): LoggerFactory {
  const sink = options.sink ?? defaultLogSink;

  return {
    createLogger(bindings = {}) {
      return createLogger(options.serviceName, options.level, sink, bindings);
    },
  };
}

export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return requestContextStore.run(context, callback);
}

export function setRequestContext(context: RequestContext): RequestContext {
  requestContextStore.enterWith(context);
  return context;
}

export function getRequestContext(): RequestContext | undefined {
  return requestContextStore.getStore();
}

export function updateRequestContext(patch: Partial<RequestContext>): RequestContext | undefined {
  const current = requestContextStore.getStore();

  if (current == null) {
    return undefined;
  }

  const nextContext = { ...current, ...patch };
  requestContextStore.enterWith(nextContext);
  return nextContext;
}

export function correlationMetadataToLogFields(
  correlation?: CorrelationMetadata,
): LogFields | undefined {
  if (correlation == null) {
    return undefined;
  }

  return {
    analyticsKey: correlation.analyticsKey,
    approvalId: correlation.approvalId,
    channelUpdateKey: correlation.channelUpdateKey,
    handsRunId: correlation.handsRunId,
    headTurnId: correlation.headTurnId,
    idempotencyKey: correlation.idempotencyKey,
    inboundMessageId: correlation.inboundMessageId,
    outboundMessageId: correlation.outboundMessageId,
    requestedBy: correlation.requestedBy,
    sandboxSessionId: correlation.sandboxSessionId,
    scheduleId: correlation.scheduleId,
    scheduleOccurrenceKey: correlation.scheduleOccurrenceKey,
    taskId: correlation.taskId,
    traceId: correlation.traceId,
  };
}

export function redactLogFields(fields: LogFields): LogFields {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, redactUnknownValue(value, key)]),
  );
}

export const observabilityPlaceholder = 'observability' as const;

export function formatLogLine(scope: string, message: string): string {
  return `[${scope}] ${message}`;
}

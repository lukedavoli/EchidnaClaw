import { createHash, randomBytes } from 'node:crypto';

import type { CorrelationMetadata } from '@echidna-claw/contracts';

export const TRACEPARENT_HEADER = 'traceparent';
export const TRACESTATE_HEADER = 'tracestate';
export const X_TRACE_ID_HEADER = 'x-trace-id';

function toFixedHex(input: string, length: number): string {
  const sanitized = input.toLowerCase().replace(/[^a-f0-9]/g, '');
  if (sanitized.length >= length) {
    return sanitized.slice(0, length);
  }

  if (sanitized.length > 0) {
    return sanitized.padEnd(length, '0');
  }

  return createHash('sha256').update(input).digest('hex').slice(0, length);
}

function deriveTraceIdHex(traceId: string): string {
  const normalized = traceId.startsWith('trc_') ? traceId.slice(4) : traceId;
  return toFixedHex(normalized, 32);
}

function createSpanId(): string {
  return randomBytes(8).toString('hex');
}

export function createTraceparent(traceId: string, spanId = createSpanId()): string {
  return `00-${deriveTraceIdHex(traceId)}-${toFixedHex(spanId, 16)}-01`;
}

export function createTraceHeaders(input: {
  correlation?: CorrelationMetadata;
  traceId?: string;
  tracestate?: string | null;
}): Record<string, string> {
  const traceId = input.traceId ?? input.correlation?.traceId;
  if (!traceId) {
    return {};
  }

  const headers: Record<string, string> = {
    [X_TRACE_ID_HEADER]: traceId,
    [TRACEPARENT_HEADER]: createTraceparent(traceId),
  };

  if (input.tracestate) {
    headers[TRACESTATE_HEADER] = input.tracestate;
  }

  return headers;
}

export function resolveTraceIdFromHeaders(headers: Record<string, string | string[] | undefined>): string | null {
  const direct = headers[X_TRACE_ID_HEADER];
  const directValue = Array.isArray(direct) ? direct[0] : direct;
  if (directValue && directValue.trim() !== '') {
    return directValue.trim();
  }

  const traceparent = headers[TRACEPARENT_HEADER];
  const traceparentValue = Array.isArray(traceparent) ? traceparent[0] : traceparent;
  if (!traceparentValue) {
    return null;
  }

  const match = traceparentValue.match(/^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/i);
  return match?.[1] ? `trc_${match[1].toLowerCase()}` : null;
}

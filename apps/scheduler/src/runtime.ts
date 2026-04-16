import { randomUUID } from 'node:crypto';

import type { SchedulerConfig } from '@echidna-claw/config';
import {
  schedulerProcessDueWorkRequestSchema,
  schedulerProcessDueWorkResultSchema,
  type SchedulerProcessDueWorkResult,
} from '@echidna-claw/contracts';

const INTERNAL_RUNTIME_AUTH_HEADER = 'x-echidna-internal-token';

function createSchedulerCorrelation() {
  const suffix = randomUUID().replace(/-/g, '').toLowerCase();

  return {
    idempotencyKey: `idem_scheduler-${suffix}`,
    requestedBy: {
      kind: 'scheduler' as const,
      id: 'scheduler-job',
    },
    traceId: `trc_scheduler-${suffix}`,
  };
}

function createSchedulerUrl(apiBaseUrl: string): string {
  return new URL('/api/internal/runtime/scheduler/process-due-work', `${apiBaseUrl.replace(/\/$/, '')}/`).toString();
}

async function readResponseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      detail?: string;
      error?: {
        message?: string;
      };
      message?: string;
      title?: string;
    };

    return (
      payload.error?.message ??
      payload.message ??
      payload.detail ??
      payload.title ??
      `Scheduler runtime returned HTTP ${response.status}.`
    );
  } catch {
    return `Scheduler runtime returned HTTP ${response.status}.`;
  }
}

export async function processDueWorkRun(
  config: SchedulerConfig,
  dependencies: {
    fetchFn?: typeof fetch;
    now?: () => string;
  } = {},
): Promise<SchedulerProcessDueWorkResult> {
  const fetchFn = dependencies.fetchFn ?? fetch;
  const startedAt = dependencies.now?.() ?? new Date().toISOString();
  const request = schedulerProcessDueWorkRequestSchema.parse({
    asOf: startedAt,
    correlation: createSchedulerCorrelation(),
    maxBatchSize: config.maxBatchSize,
    maxPasses: config.maxPasses,
  });

  const response = await fetchFn(createSchedulerUrl(config.apiBaseUrl), {
    body: JSON.stringify(request),
    headers: {
      'content-type': 'application/json',
      [INTERNAL_RUNTIME_AUTH_HEADER]: config.internalAuthToken,
    },
    method: 'POST',
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });

  if (!response.ok) {
    throw new Error(await readResponseError(response));
  }

  return schedulerProcessDueWorkResultSchema.parse(await response.json());
}

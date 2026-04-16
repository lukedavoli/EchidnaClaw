import type { SchedulerConfig } from '@echidna-claw/config';
import { describe, expect, it, vi } from 'vitest';

import { processDueWorkRun } from '../src/runtime.js';

const schedulerConfig: SchedulerConfig = {
  apiBaseUrl: 'https://api.example.test/root/',
  internalAuthToken: 'test-internal-token',
  logLevel: 'info',
  maxBatchSize: 25,
  maxPasses: 2,
  nodeEnv: 'test',
  requestTimeoutMs: 15000,
  runtimeMode: 'local-minimal',
  serviceName: 'scheduler',
  sharedCloud: null,
  webPublicBaseUrl: 'https://web.example.test',
};

describe('processDueWorkRun', () => {
  it('posts the scheduler due-work request to the internal runtime endpoint', async () => {
    const responsePayload = {
      activeHeadConflictCount: 0,
      asOf: '2026-04-12T00:00:00.000Z',
      failureCount: 0,
      launchedDueTaskTurnCount: 1,
      launchedTaskIds: ['tsk_due-task'],
      materializedScheduleCount: 1,
      materializedTaskIds: ['tsk_due-task'],
      skippedByIdempotencyCount: 0,
    };
    const fetchFn = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify(responsePayload), {
        headers: {
          'content-type': 'application/json',
        },
        status: 200,
      });
    });

    const result = await processDueWorkRun(schedulerConfig, {
      fetchFn,
      now: () => '2026-04-12T00:00:00.000Z',
    });

    expect(result).toEqual(responsePayload);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const [requestUrl, requestInit] = fetchFn.mock.calls[0] ?? [];
    expect(String(requestUrl)).toBe(
      'https://api.example.test/api/internal/runtime/scheduler/process-due-work',
    );
    expect(requestInit?.method).toBe('POST');
    expect(requestInit?.headers).toMatchObject({
      'content-type': 'application/json',
      'x-echidna-internal-token': 'test-internal-token',
    });

    const requestBody = JSON.parse(String(requestInit?.body));
    expect(requestBody).toMatchObject({
      asOf: '2026-04-12T00:00:00.000Z',
      maxBatchSize: 25,
      maxPasses: 2,
    });
    expect(requestBody.correlation.idempotencyKey).toMatch(/^idem_scheduler-/);
    expect(requestBody.correlation.traceId).toMatch(/^trc_scheduler-/);
    expect(requestBody.correlation.requestedBy).toEqual({
      id: 'scheduler-job',
      kind: 'scheduler',
    });
  });

  it('surfaces structured scheduler runtime errors', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          error: {
            message: 'Internal runtime unavailable.',
          },
        }),
        {
          headers: {
            'content-type': 'application/json',
          },
          status: 503,
        },
      );
    });

    await expect(
      processDueWorkRun(schedulerConfig, {
        fetchFn,
        now: () => '2026-04-12T00:00:00.000Z',
      }),
    ).rejects.toThrow('Internal runtime unavailable.');
  });
});

import { createLoggerFactory } from '@echidna-claw/observability';
import {
  createAgent,
  createCorrelationMetadata,
  createIdempotencyRecord,
  createInMemoryRepositorySuite,
  createTask,
} from '@echidna-claw/persistence';
import { createDueTaskHeadStartKey } from '@echidna-claw/domain';
import { describe, expect, it, vi } from 'vitest';

import { createSchedulerRuntimeService } from '../../src/services/runtime/scheduler-runtime-service.js';

function createRepositoryBundle() {
  const suite = createInMemoryRepositorySuite();

  return {
    repositories: {
      agents: suite.agents,
      agentRegistry: suite.agentRegistry,
      analytics: {
        async getOverview() {
          return {
            totalEstimatedCostUsd: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            events: [],
          };
        },
      },
      approvals: {
        async getState() {
          return 'requested' as const;
        },
      },
      channels: suite.channels,
      credentials: suite.credentials,
      execution: suite.execution,
      idempotency: suite.idempotency,
      messages: suite.messages,
      runJournals: suite.runJournals,
      schedules: suite.schedules,
      tasks: suite.tasks,
      workingContexts: suite.workingContexts,
    },
    suite,
  };
}

describe('createSchedulerRuntimeService', () => {
  it('retries due-task starts after an expired idempotency record', async () => {
    const { repositories } = createRepositoryBundle();
    const loggerFactory = createLoggerFactory({
      level: 'debug',
      serviceName: 'scheduler-runtime-test',
      sink: () => {},
    });
    const dueAt = '2026-04-12T00:00:00.000Z';
    const taskId = 'tsk_scheduler-retry';
    const correlation = createCorrelationMetadata({
      idempotencyKey: 'idem_scheduler-retry',
      taskId,
      traceId: 'trc_scheduler-retry',
    });

    await repositories.agents.create(
      createAgent({
        id: 'agt_scheduler-retry',
        correlation,
        primaryChannelId: 'chn_scheduler-retry',
      }),
    );
    await repositories.tasks.createTask(
      createTask({
        id: taskId,
        agentId: 'agt_scheduler-retry',
        correlation,
        state: 'deferred',
        dueAt,
        stateEnteredAt: dueAt,
        type: 'scheduled_task',
        queue: {
          lane: 'scheduled',
          priority: 'normal',
        },
        requestedBy: {
          kind: 'schedule',
          sourceScheduleId: 'sch_scheduler-retry',
        },
        scheduleId: 'sch_scheduler-retry',
        activeTaskEnvelopeId: null,
        currentRunJournalId: null,
        currentHandsRunId: null,
      }),
    );
    await repositories.idempotency.reserve(
      createIdempotencyRecord({
        id: 'idr_scheduler-retry',
        agentId: 'agt_scheduler-retry',
        correlation,
        scope: 'scheduler:due-task-head-start',
        key: createDueTaskHeadStartKey(taskId, dueAt),
        status: 'expired',
        resultReference: taskId,
        expiresAt: null,
      }),
    );

    const startTurn = vi.fn(async () => {
      return {
        effectSummary: {
          approvalRequested: false,
          memoryOperationRequested: false,
          sandboxRequested: false,
          scheduleChangeRequested: false,
          taskRequested: false,
        },
        headTurn: {
          id: 'hdr_scheduler-retry',
        },
        replyDraft: null,
      };
    });
    const service = createSchedulerRuntimeService({
      headRuntimeService: {
        startTurn,
        async supersedeTurn() {
          throw new Error('unused');
        },
      },
      logger: loggerFactory.createLogger({ service: 'scheduler_runtime_test' }),
      repositories,
    });

    const result = await service.processDueWork({
      asOf: '2026-04-12T00:05:00.000Z',
      correlation: createCorrelationMetadata({
        idempotencyKey: 'idem_scheduler-run',
        traceId: 'trc_scheduler-run',
      }),
      maxBatchSize: 5,
      maxPasses: 1,
    });

    expect(startTurn).toHaveBeenCalledTimes(1);
    expect(result.failureCount).toBe(0);
    expect(result.launchedDueTaskTurnCount).toBe(1);
    expect(result.skippedByIdempotencyCount).toBe(0);

    const storedIdempotency = await repositories.idempotency.getByScopeAndKey(
      'agt_scheduler-retry',
      'scheduler:due-task-head-start',
      createDueTaskHeadStartKey(taskId, dueAt),
    );
    expect(storedIdempotency?.value.status).toBe('completed');
    expect(storedIdempotency?.value.resultReference).toBe('hdr_scheduler-retry');
  });
});

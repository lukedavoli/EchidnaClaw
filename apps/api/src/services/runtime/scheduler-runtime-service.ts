import { randomBytes } from 'node:crypto';

import type {
  HeadService,
  SchedulerProcessDueWorkRequest,
  SchedulerProcessDueWorkResult,
  SchedulerService,
  Task,
} from '@echidna-claw/contracts';
import { schedulerProcessDueWorkResultSchema } from '@echidna-claw/contracts';
import {
  calculateNextDueAt,
  createDefaultTaskLaunchState,
  createDeferredTaskProgressSummary,
  createDueTaskHeadStartKey,
  createScheduleOccurrenceKey,
  createTaskMergeKey,
  withTaskProgressSummary,
} from '@echidna-claw/domain';
import type { Logger } from '@echidna-claw/observability';
import {
  DuplicateRecordError,
  OptimisticConcurrencyError,
} from '@echidna-claw/persistence';

import type { RepositoryBundle } from '../../adapters/repositories/index.js';
import { ConflictError } from '../../http/errors.js';
import type { AuditHistoryService } from './audit-history-service.js';

const SCHEDULE_OCCURRENCE_SCOPE = 'scheduler:schedule-occurrence';
const DUE_TASK_HEAD_START_SCOPE = 'scheduler:due-task-head-start';

function createRuntimeIdentifier(prefix: 'idr' | 'tsk'): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

function createScheduleOccurrenceTask(input: {
  asOf: string;
  occurrenceAt: string;
  schedule: {
    agentId: string;
    correlation: SchedulerProcessDueWorkRequest['correlation'];
    description: string;
    id: string;
    naturalLanguageRequest: string;
  };
}): Task {
  const taskId = createRuntimeIdentifier('tsk');
  const mergeKey = createTaskMergeKey({
    agentId: input.schedule.agentId,
    dueAt: input.occurrenceAt,
    requestedByKind: 'schedule',
    requestedOutcome: input.schedule.description,
    taskType: 'scheduled_task',
  });
  const task = {
    id: taskId,
    recordType: 'task',
    schemaVersion: 1,
    createdAt: input.asOf,
    updatedAt: input.asOf,
    correlation: {
      ...input.schedule.correlation,
      scheduleId: input.schedule.id,
      scheduleOccurrenceKey: createScheduleOccurrenceKey(input.schedule.id, input.occurrenceAt),
      taskId,
    },
    agentId: input.schedule.agentId,
    type: 'scheduled_task',
    state: 'deferred',
    queue: {
      lane: 'scheduled',
      priority: 'normal',
    },
    requestedOutcome: input.schedule.description,
    requestedBy: {
      kind: 'schedule',
      sourceScheduleId: input.schedule.id,
    },
    dueAt: input.occurrenceAt,
    stateEnteredAt: input.asOf,
    scheduleId: input.schedule.id,
    activeTaskEnvelopeId: null,
    currentRunJournalId: null,
    currentHandsRunId: null,
    activeApprovalId: null,
    activeCredentialCaptureId: null,
    mergeKey,
    mergedIntoTaskId: null,
    attemptCount: 1,
    launchState: createDefaultTaskLaunchState(),
    progressSummary: null,
    lastProgressAt: null,
    lastCheckpointAt: null,
    cancellationRequestedAt: null,
    cancellationReason: null,
    completedAt: null,
    failedAt: null,
    cancelledAt: null,
    artifactIds: [],
    externalReferences: [],
    notes: input.schedule.naturalLanguageRequest,
  } satisfies Task;

  return withTaskProgressSummary(
    task,
    createDeferredTaskProgressSummary({
      detail: `Waiting for the scheduled occurrence due at ${input.occurrenceAt}.`,
      lastActor: 'scheduler',
      requestedOutcome: input.schedule.description,
    }),
    input.asOf,
  );
}

async function reserveDueTaskStart(input: {
  asOf: string;
  correlation: SchedulerProcessDueWorkRequest['correlation'];
  existingIdempotency: Awaited<ReturnType<RepositoryBundle['idempotency']['getByScopeAndKey']>>;
  repositories: RepositoryBundle;
  startKey: string;
  task: Task;
}): Promise<Awaited<ReturnType<RepositoryBundle['idempotency']['reserve']>> | null> {
  const nextRecord = {
    id: input.existingIdempotency?.value.id ?? createRuntimeIdentifier('idr'),
    recordType: 'idempotency_record' as const,
    schemaVersion: 1 as const,
    createdAt: input.existingIdempotency?.value.createdAt ?? input.asOf,
    updatedAt: input.asOf,
    correlation: {
      ...input.correlation,
      scheduleId: input.task.scheduleId,
      taskId: input.task.id,
    },
    agentId: input.task.agentId,
    scope: DUE_TASK_HEAD_START_SCOPE,
    key: input.startKey,
    status: 'reserved' as const,
    resultReference: input.task.id,
    expiresAt: null,
  };

  if (!input.existingIdempotency) {
    return input.repositories.idempotency.reserve(nextRecord);
  }

  if (input.existingIdempotency.value.status !== 'expired') {
    return null;
  }

  // Reuse expired retry markers so a transient failure does not permanently block future starts.
  return input.repositories.idempotency.complete(nextRecord, input.existingIdempotency.etag);
}

async function appendSchedulerAuditSafe(input: {
  action: string;
  agentId: string;
  attributes: Record<string, unknown>;
  auditHistoryService?: AuditHistoryService;
  category: 'due_task';
  correlation: SchedulerProcessDueWorkRequest['correlation'];
  logger: Logger;
  occurredAt: string;
  outcome: 'attempted' | 'succeeded' | 'failed' | 'cancelled' | 'denied' | 'expired';
  summary: string;
}): Promise<void> {
  if (!input.auditHistoryService) {
    input.logger.warn('scheduler_runtime.audit_history_unavailable', {
      action: input.action,
      agentId: input.agentId,
    });
    return;
  }

  try {
    await input.auditHistoryService.append({
      action: input.action,
      agentId: input.agentId,
      attributes: input.attributes,
      category: input.category,
      correlation: input.correlation,
      occurredAt: input.occurredAt,
      outcome: input.outcome,
      summary: input.summary,
    });
  } catch (error) {
    input.logger.warn('scheduler_runtime.audit_append_failed', {
      action: input.action,
      agentId: input.agentId,
      message: error instanceof Error ? error.message : 'Unknown audit append failure.',
    });
  }
}

export function createSchedulerRuntimeService(options: {
  auditHistoryService: AuditHistoryService;
  headRuntimeService: HeadService;
  logger: Logger;
  repositories: RepositoryBundle;
}): SchedulerService {
  return {
    async processDueWork(
      input: SchedulerProcessDueWorkRequest,
    ): Promise<SchedulerProcessDueWorkResult> {
      options.logger.info('scheduler_runtime.process_due_work', {
        asOf: input.asOf,
        maxBatchSize: input.maxBatchSize,
        maxPasses: input.maxPasses,
      });

      const batchSize = input.maxBatchSize ?? 50;
      const maxPasses = input.maxPasses ?? 1;
      const summary: SchedulerProcessDueWorkResult = {
        activeHeadConflictCount: 0,
        asOf: input.asOf,
        failureCount: 0,
        launchedDueTaskTurnCount: 0,
        launchedTaskIds: [],
        materializedScheduleCount: 0,
        materializedTaskIds: [],
        skippedByIdempotencyCount: 0,
      };
      const appendAudit = (entry: {
        action: string;
        agentId: string;
        attributes: Record<string, unknown>;
        category: 'due_task';
        correlation: SchedulerProcessDueWorkRequest['correlation'];
        occurredAt: string;
        outcome: 'attempted' | 'succeeded' | 'failed' | 'cancelled' | 'denied' | 'expired';
        summary: string;
      }) =>
        appendSchedulerAuditSafe({
          ...entry,
          auditHistoryService: options.auditHistoryService,
          logger: options.logger,
        });

      for (let pass = 0; pass < maxPasses; pass += 1) {
        let passMadeProgress = false;
        const dueSchedules = await options.repositories.schedules.listDueSchedules(input.asOf, batchSize);

        for (const storedSchedule of dueSchedules) {
          const occurrenceAt = storedSchedule.value.nextDueAt;
          if (!occurrenceAt) {
            continue;
          }

          const occurrenceKey = createScheduleOccurrenceKey(storedSchedule.value.id, occurrenceAt);
          const existingIdempotency = await options.repositories.idempotency.getByScopeAndKey(
            storedSchedule.value.agentId,
            SCHEDULE_OCCURRENCE_SCOPE,
            occurrenceKey,
          );
          if (existingIdempotency) {
            summary.skippedByIdempotencyCount += 1;
            await appendAudit({
              action: 'due_task.materialize.skipped',
              agentId: storedSchedule.value.agentId,
              attributes: {
                occurrenceKey,
                scheduleId: storedSchedule.value.id,
              },
              category: 'due_task',
              correlation: {
                ...input.correlation,
                scheduleId: storedSchedule.value.id,
                scheduleOccurrenceKey: occurrenceKey,
              },
              occurredAt: input.asOf,
              outcome: 'cancelled',
              summary: `Skipped duplicate schedule occurrence for '${storedSchedule.value.description}'.`,
            });
            continue;
          }

          const task = createScheduleOccurrenceTask({
            asOf: input.asOf,
            occurrenceAt,
            schedule: {
              agentId: storedSchedule.value.agentId,
              correlation: input.correlation,
              description: storedSchedule.value.description,
              id: storedSchedule.value.id,
              naturalLanguageRequest: storedSchedule.value.naturalLanguageRequest,
            },
          });
          const nextDueAt = calculateNextDueAt(storedSchedule.value, occurrenceAt);
          const updatedSchedule = {
            ...storedSchedule.value,
            updatedAt: input.asOf,
            nextDueAt,
            lastMaterializedOccurrenceAt: occurrenceAt,
          };

          try {
            await options.repositories.schedules.materializeDueOccurrenceTask({
              idempotencyRecord: {
                id: createRuntimeIdentifier('idr'),
                recordType: 'idempotency_record',
                schemaVersion: 1,
                createdAt: input.asOf,
                updatedAt: input.asOf,
                correlation: {
                  ...input.correlation,
                  scheduleId: storedSchedule.value.id,
                  scheduleOccurrenceKey: occurrenceKey,
                  taskId: task.id,
                },
                agentId: storedSchedule.value.agentId,
                scope: SCHEDULE_OCCURRENCE_SCOPE,
                key: occurrenceKey,
                status: 'completed',
                resultReference: task.id,
                expiresAt: null,
              },
              schedule: updatedSchedule,
              scheduleEtag: storedSchedule.etag,
              task,
            });
            passMadeProgress = true;
            summary.materializedScheduleCount += 1;
            summary.materializedTaskIds.push(task.id);
            await appendAudit({
              action: 'due_task.materialize.succeeded',
              agentId: task.agentId,
              attributes: {
                occurrenceKey,
                scheduleId: storedSchedule.value.id,
                taskId: task.id,
              },
              category: 'due_task',
              correlation: {
                ...task.correlation,
                scheduleId: storedSchedule.value.id,
                scheduleOccurrenceKey: occurrenceKey,
                taskId: task.id,
              },
              occurredAt: input.asOf,
              outcome: 'succeeded',
              summary: `Materialized due task '${task.id}' for schedule '${storedSchedule.value.id}'.`,
            });
          } catch (error) {
            if (error instanceof DuplicateRecordError || error instanceof OptimisticConcurrencyError) {
              summary.skippedByIdempotencyCount += 1;
              await appendAudit({
                action: 'due_task.materialize.skipped',
                agentId: storedSchedule.value.agentId,
                attributes: {
                  occurrenceKey,
                  reason: 'concurrent_duplicate',
                  scheduleId: storedSchedule.value.id,
                },
                category: 'due_task',
                correlation: {
                  ...input.correlation,
                  scheduleId: storedSchedule.value.id,
                  scheduleOccurrenceKey: occurrenceKey,
                },
                occurredAt: input.asOf,
                outcome: 'cancelled',
                summary: `Skipped duplicate materialization for schedule '${storedSchedule.value.id}'.`,
              });
              continue;
            }

            summary.failureCount += 1;
            options.logger.warn('scheduler_runtime.materialize_schedule_failed', {
              message: error instanceof Error ? error.message : 'Unknown materialization failure.',
              scheduleId: storedSchedule.value.id,
            });
            await appendAudit({
              action: 'due_task.materialize.failed',
              agentId: storedSchedule.value.agentId,
              attributes: {
                message: error instanceof Error ? error.message : 'Unknown materialization failure.',
                occurrenceKey,
                scheduleId: storedSchedule.value.id,
              },
              category: 'due_task',
              correlation: {
                ...input.correlation,
                scheduleId: storedSchedule.value.id,
                scheduleOccurrenceKey: occurrenceKey,
              },
              occurredAt: input.asOf,
              outcome: 'failed',
              summary: `Failed to materialize the due task for schedule '${storedSchedule.value.id}'.`,
            });
          }
        }

        const dueDeferredTasks = await options.repositories.tasks.listDueDeferredTasks(
          input.asOf,
          batchSize,
        );

        for (const storedTask of dueDeferredTasks) {
          if (!storedTask.value.dueAt) {
            continue;
          }

          const startKey = createDueTaskHeadStartKey(storedTask.value.id, storedTask.value.dueAt);
          const existingIdempotency = await options.repositories.idempotency.getByScopeAndKey(
            storedTask.value.agentId,
            DUE_TASK_HEAD_START_SCOPE,
            startKey,
          );
          const reserved = await reserveDueTaskStart({
            asOf: input.asOf,
            correlation: input.correlation,
            existingIdempotency,
            repositories: options.repositories,
            startKey,
            task: storedTask.value,
          });
          if (!reserved) {
            summary.skippedByIdempotencyCount += 1;
            await appendAudit({
              action: 'due_task.dispatch.skipped',
              agentId: storedTask.value.agentId,
              attributes: {
                dueAt: storedTask.value.dueAt,
                startKey,
                taskId: storedTask.value.id,
              },
              category: 'due_task',
              correlation: {
                ...input.correlation,
                scheduleId: storedTask.value.scheduleId,
                taskId: storedTask.value.id,
              },
              occurredAt: input.asOf,
              outcome: 'cancelled',
              summary: `Skipped duplicate due-task dispatch for '${storedTask.value.id}'.`,
            });
            continue;
          }

          await appendAudit({
            action: 'due_task.dispatch.attempted',
            agentId: storedTask.value.agentId,
            attributes: {
              dueAt: storedTask.value.dueAt,
              startKey,
              taskId: storedTask.value.id,
            },
            category: 'due_task',
            correlation: {
              ...input.correlation,
              scheduleId: storedTask.value.scheduleId,
              taskId: storedTask.value.id,
            },
            occurredAt: input.asOf,
            outcome: 'attempted',
            summary: `Dispatching Head for due task '${storedTask.value.id}'.`,
          });

          try {
            const startedTurn = await options.headRuntimeService.startTurn({
              agentId: storedTask.value.agentId,
              correlation: {
                ...input.correlation,
                idempotencyKey: startKey,
                requestedBy: {
                  kind: 'scheduler',
                  id: 'scheduler-runtime',
                },
                scheduleId: storedTask.value.scheduleId,
                taskId: storedTask.value.id,
              },
              trigger: {
                kind: 'due_task',
                dueAt: storedTask.value.dueAt,
                ...(storedTask.value.scheduleId ? { scheduleId: storedTask.value.scheduleId } : {}),
                taskId: storedTask.value.id,
              },
            });
            await options.repositories.idempotency.complete(
              {
                ...reserved.value,
                updatedAt: input.asOf,
                status: 'completed',
                resultReference: startedTurn.headTurn.id,
              },
              reserved.etag,
            );
            passMadeProgress = true;
            summary.launchedDueTaskTurnCount += 1;
            summary.launchedTaskIds.push(storedTask.value.id);
            await appendAudit({
              action: 'due_task.dispatch.succeeded',
              agentId: storedTask.value.agentId,
              attributes: {
                headTurnId: startedTurn.headTurn.id,
                taskId: storedTask.value.id,
              },
              category: 'due_task',
              correlation: {
                ...input.correlation,
                headTurnId: startedTurn.headTurn.id,
                scheduleId: storedTask.value.scheduleId,
                taskId: storedTask.value.id,
              },
              occurredAt: input.asOf,
              outcome: 'succeeded',
              summary: `Launched Head turn '${startedTurn.headTurn.id}' for due task '${storedTask.value.id}'.`,
            });
          } catch (error) {
            const expiredRecord = {
              ...reserved.value,
              updatedAt: input.asOf,
              status: 'expired' as const,
              resultReference: storedTask.value.id,
            };

            await options.repositories.idempotency.expire(expiredRecord, reserved.etag);

            if (error instanceof ConflictError) {
              summary.activeHeadConflictCount += 1;
              await appendAudit({
                action: 'due_task.dispatch.conflict',
                agentId: storedTask.value.agentId,
                attributes: {
                  message: error.message,
                  taskId: storedTask.value.id,
                },
                category: 'due_task',
                correlation: {
                  ...input.correlation,
                  scheduleId: storedTask.value.scheduleId,
                  taskId: storedTask.value.id,
                },
                occurredAt: input.asOf,
                outcome: 'cancelled',
                summary: `Skipped due-task dispatch for '${storedTask.value.id}' because another Head turn is active.`,
              });
              continue;
            }

            summary.failureCount += 1;
            options.logger.warn('scheduler_runtime.start_due_task_failed', {
              message: error instanceof Error ? error.message : 'Unknown due-task start failure.',
              taskId: storedTask.value.id,
            });
            await appendAudit({
              action: 'due_task.dispatch.failed',
              agentId: storedTask.value.agentId,
              attributes: {
                message: error instanceof Error ? error.message : 'Unknown due-task start failure.',
                taskId: storedTask.value.id,
              },
              category: 'due_task',
              correlation: {
                ...input.correlation,
                scheduleId: storedTask.value.scheduleId,
                taskId: storedTask.value.id,
              },
              occurredAt: input.asOf,
              outcome: 'failed',
              summary: `Failed to dispatch due task '${storedTask.value.id}'.`,
            });
          }
        }

        if (!passMadeProgress) {
          break;
        }
      }

      return schedulerProcessDueWorkResultSchema.parse(summary);
    },
  };
}

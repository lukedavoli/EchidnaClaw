import { randomBytes } from 'node:crypto';

import type {
  Approval,
  CredentialCapture,
  EnqueueTaskRequest,
  EnqueueTaskResult,
  ExternalReference,
  IdempotencyRecord,
  RequestQueuedTaskStartRequest,
  RequestQueuedTaskStartResult,
  RunJournal,
  RunJournalEntry,
  Task,
  TaskEnvelope,
  TaskStatusSnapshot,
  WorkingContext,
} from '@echidna-claw/contracts';
import {
  enqueueTaskRequestSchema,
  enqueueTaskResultSchema,
  requestQueuedTaskStartRequestSchema,
  requestQueuedTaskStartResultSchema,
  taskStatusSnapshotSchema,
} from '@echidna-claw/contracts';
import {
  createDefaultTaskLaunchState,
  createDeferredTaskProgressSummary,
  createQueuedTaskProgressSummary,
  createTaskCreationIdempotencyKey,
  createTaskMergeKey,
  createTaskStartRequestIdempotencyKey,
  markTaskLaunchFailed,
  markTaskLaunchRequested,
  resetTaskLaunchState,
  transitionTaskState,
  withTaskProgressSummary,
} from '@echidna-claw/domain';
import type { Logger } from '@echidna-claw/observability';
import type { StoredRecord } from '@echidna-claw/persistence';

import type { HandsJobTriggerAdapter } from '../../adapters/jobs/index.js';
import type { RepositoryBundle } from '../../adapters/repositories/index.js';
import { ConflictError, NotFoundError } from '../../http/errors.js';

const START_REQUEST_SCOPE = 'hands:start-request';

type MergeDisposition = EnqueueTaskResult['disposition'];
type QueueServiceClock = () => string;

export interface TaskQueueService {
  enqueueTask(input: EnqueueTaskRequest): Promise<EnqueueTaskResult>;
  activateDeferredTask(
    input: EnqueueTaskRequest & {
      taskId: string;
    },
  ): Promise<EnqueueTaskResult>;
  getTaskStatusSnapshot(input: {
    agentId: string;
    workingContextId: string;
  }): Promise<TaskStatusSnapshot>;
  requestQueuedTaskStart(input: RequestQueuedTaskStartRequest): Promise<RequestQueuedTaskStartResult>;
}

function createRuntimeIdentifier(prefix: 'tsk' | 'env' | 'idr' | 'rje' | 'rjn'): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

function getQueueingScope(input: EnqueueTaskRequest): string {
  switch (input.requestedBy.kind) {
    case 'schedule':
      return 'scheduler:enqueue-task';
    case 'system':
      return 'system:repair-enqueue';
    case 'user':
    default:
      return 'head:create-task';
  }
}

function getJournalScope(input: EnqueueTaskRequest): Pick<RunJournal, 'scope' | 'scopeId'> {
  if (input.headTurnId) {
    return {
      scope: 'head_turn',
      scopeId: input.headTurnId,
    };
  }

  if (input.requestedBy.kind === 'schedule') {
    return {
      scope: 'scheduler',
      scopeId: input.requestedBy.sourceScheduleId ?? `schedule-${input.agentId}`,
    };
  }

  return {
    scope: 'head_turn',
    scopeId: `queue-${input.workingContextId}`,
  };
}

function mapQueueStartError(error: unknown): {
  code: string;
  message: string;
} {
  if (error instanceof Error) {
    return {
      code: 'hands_start_request_failed',
      message: error.message,
    };
  }

  return {
    code: 'hands_start_request_failed',
    message: 'Hands start request failed unexpectedly.',
  };
}

function mergeNotes(existing: string, incoming: string): string {
  const normalizedExisting = existing.trim();
  const normalizedIncoming = incoming.trim();

  if (!normalizedIncoming) {
    return normalizedExisting;
  }

  if (!normalizedExisting || normalizedExisting === normalizedIncoming) {
    return normalizedIncoming;
  }

  return `${normalizedExisting}\n${normalizedIncoming}`;
}

function mergeExternalReferences(
  existing: readonly ExternalReference[],
  incoming: readonly ExternalReference[],
): ExternalReference[] {
  const merged = new Map<string, ExternalReference>();

  for (const reference of [...existing, ...incoming]) {
    merged.set(`${reference.type}:${reference.reference}`, reference);
  }

  return [...merged.values()];
}

function mergeQueueDescriptor(
  current: Task['queue'],
  incoming: Pick<EnqueueTaskRequest, 'lane' | 'priority'>,
): Task['queue'] {
  const priorityRank: Record<Task['queue']['priority'], number> = {
    urgent: 0,
    high: 1,
    normal: 2,
    low: 3,
  };

  const incomingPriorityRank = priorityRank[incoming.priority];
  const currentPriorityRank = priorityRank[current.priority];
  if (incomingPriorityRank == null || currentPriorityRank == null) {
    throw new Error('Unsupported queue priority.');
  }

  return {
    ...current,
    lane: current.lane,
    priority:
      incomingPriorityRank < currentPriorityRank ? incoming.priority : current.priority,
  };
}

function buildWorkingContextUpdate(
  workingContext: WorkingContext,
  taskId: string,
  updatedAt: string,
): WorkingContext {
  return {
    ...workingContext,
    activeTaskId: taskId,
    openTaskIds: workingContext.openTaskIds.includes(taskId)
      ? workingContext.openTaskIds
      : [...workingContext.openTaskIds, taskId],
    updatedAt,
  };
}

function buildDeferredWorkingContextUpdate(
  workingContext: WorkingContext,
  taskId: string,
  updatedAt: string,
): WorkingContext {
  return {
    ...workingContext,
    openTaskIds: workingContext.openTaskIds.includes(taskId)
      ? workingContext.openTaskIds
      : [...workingContext.openTaskIds, taskId],
    updatedAt,
  };
}

function isFutureDueAt(dueAt: string | null, asOf: string): boolean {
  return dueAt != null && dueAt > asOf;
}

function buildInitialRunJournal(input: {
  correlation: EnqueueTaskRequest['correlation'];
  createdAt: string;
  request: EnqueueTaskRequest;
  summary: Task['progressSummary'];
  taskId: string;
}): RunJournal {
  const scope = getJournalScope(input.request);

  return {
    id: createRuntimeIdentifier('rjn'),
    recordType: 'run_journal',
    schemaVersion: 1,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    correlation: {
      ...input.correlation,
      taskId: input.taskId,
    },
    agentId: input.request.agentId,
    ...scope,
    taskId: input.taskId,
    handsRunId: null,
    status: 'open',
    openedAt: input.createdAt,
    closedAt: null,
    summary: input.summary?.headline ?? '',
    progressSummary: input.summary,
    lastEntryAt: input.createdAt,
    resultCode: null,
  };
}

function buildRunJournalEntry(input: {
  agentId: string;
  correlation: EnqueueTaskRequest['correlation'];
  createdAt: string;
  entryKind: RunJournalEntry['entryKind'];
  journalId: string;
  message: string;
  progressSummary: Task['progressSummary'];
  taskId: string;
}): RunJournalEntry {
  return {
    id: createRuntimeIdentifier('rje'),
    recordType: 'run_journal_entry',
    schemaVersion: 1,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    correlation: {
      ...input.correlation,
      taskId: input.taskId,
    },
    journalId: input.journalId,
    agentId: input.agentId,
    entryKind: input.entryKind,
    level: 'info',
    recordedAt: input.createdAt,
    message: input.message,
    taskStateAfter: 'queued',
    progressSummaryPatch: input.progressSummary,
    artifactIds: [],
    approvalId: null,
  };
}

function shouldCreateReplacementEnvelope(input: {
  existingEnvelope: TaskEnvelope | null;
  existingTask: Task;
  request: EnqueueTaskRequest;
  task: Task;
}): boolean {
  if (!input.existingEnvelope) {
    return true;
  }

  if (input.existingTask.state === 'deferred') {
    return true;
  }

  return (
    input.existingEnvelope.requestedOutcome !== input.task.requestedOutcome ||
    input.existingEnvelope.dueAt !== input.task.dueAt ||
    input.existingEnvelope.queue.priority !== input.task.queue.priority ||
    input.existingEnvelope.notes !== input.task.notes ||
    input.existingEnvelope.workingContextSummary !== input.request.workingContextSummary ||
    JSON.stringify(input.existingEnvelope.externalReferences) !==
      JSON.stringify(input.task.externalReferences)
  );
}

export function createTaskQueueService(options: {
  handsJobs: HandsJobTriggerAdapter;
  logger: Logger;
  now?: QueueServiceClock;
  repositories: RepositoryBundle;
}): TaskQueueService {
  const clock = options.now ?? (() => new Date().toISOString());

  async function getWorkingContext(agentId: string, workingContextId: string) {
    const storedWorkingContext = await options.repositories.workingContexts.get(
      agentId,
      workingContextId,
    );
    if (!storedWorkingContext) {
      throw new NotFoundError('Working context not found.');
    }

    return storedWorkingContext;
  }

  async function getActiveEnvelope(task: Task) {
    if (!task.activeTaskEnvelopeId) {
      return null;
    }

    return options.repositories.tasks.getTaskEnvelope(task.agentId, task.activeTaskEnvelopeId);
  }

  async function getActiveJournal(task: Task) {
    if (task.currentRunJournalId) {
      const stored = await options.repositories.runJournals.getJournal(
        task.agentId,
        task.currentRunJournalId,
      );
      if (stored) {
        return stored;
      }
    }

    return options.repositories.runJournals.getLatestJournalForTask(task.agentId, task.id);
  }

  async function buildStatusItems(taskIds: readonly string[], agentId: string) {
    const storedTasks = await Promise.all(
      taskIds.map((taskId) => options.repositories.tasks.getTask(agentId, taskId)),
    );
    const openTasks = storedTasks
      .filter((task): task is NonNullable<(typeof storedTasks)[number]> => task != null)
      .filter((task) =>
        ['queued', 'running', 'waiting_for_user', 'deferred'].includes(task.value.state),
      );

    return Promise.all(
      openTasks.map(async (storedTask) => {
        const runSummary =
          storedTask.value.currentRunJournalId != null
            ? await options.repositories.runJournals.getJournal(
                agentId,
                storedTask.value.currentRunJournalId,
              )
            : await options.repositories.runJournals.getLatestJournalForTask(agentId, storedTask.value.id);

        return {
          activeApprovalId: storedTask.value.activeApprovalId,
          activeCredentialCaptureId: storedTask.value.activeCredentialCaptureId,
          currentRunJournalId: storedTask.value.currentRunJournalId,
          dueAt: storedTask.value.dueAt,
          launchState: storedTask.value.launchState,
          progressSummary: storedTask.value.progressSummary,
          queue: storedTask.value.queue,
          requestedOutcome: storedTask.value.requestedOutcome,
          runSummary: runSummary
            ? {
                journalId: runSummary.value.id,
                status: runSummary.value.status,
                summary: runSummary.value.summary,
                resultCode: runSummary.value.resultCode,
                lastEntryAt: runSummary.value.lastEntryAt,
                progressSummary: runSummary.value.progressSummary,
              }
            : null,
          state: storedTask.value.state,
          taskId: storedTask.value.id,
          taskType: storedTask.value.type,
        };
      }),
    );
  }

  return {
    async enqueueTask(input: EnqueueTaskRequest): Promise<EnqueueTaskResult> {
      const request = enqueueTaskRequestSchema.parse(input);
      const requestedAt = clock();
      const shouldDefer = isFutureDueAt(request.dueAt, requestedAt);
      const mergeKey = createTaskMergeKey({
        agentId: request.agentId,
        dueAt: request.dueAt,
        externalReferences: request.externalReferences,
        requestedByKind: request.requestedBy.kind,
        requestedOutcome: request.requestedOutcome,
        taskType: request.taskType,
      });
      const queueingIdempotencyKey = createTaskCreationIdempotencyKey(
        request.agentId,
        request.requestedOutcome,
        request.dueAt,
        request.taskType,
        request.headTurnId ?? request.workingContextId,
      );
      const queueingScope = getQueueingScope(request);
      const replay = await options.repositories.idempotency.getByScopeAndKey(
        request.agentId,
        queueingScope,
        queueingIdempotencyKey,
      );

      if (replay?.value.resultReference) {
        const replayTask = await options.repositories.tasks.getTask(
          request.agentId,
          replay.value.resultReference as Task['id'],
        );
        if (!replayTask) {
          throw new ConflictError('The enqueue idempotency record references an incomplete task.');
        }

        return enqueueTaskResultSchema.parse({
          disposition: 'merged_into_existing_task',
          runJournalId: replayTask.value.currentRunJournalId,
          startRequest: null,
          taskEnvelopeId: replayTask.value.activeTaskEnvelopeId,
          taskId: replayTask.value.id,
          taskState: replayTask.value.state,
        });
      }

      const storedWorkingContext = await getWorkingContext(request.agentId, request.workingContextId);
      const mergeCandidates = await options.repositories.tasks.listMergeCandidates(
        request.agentId,
        mergeKey,
      );
      const mergeCandidate = mergeCandidates.find(
        (candidate) =>
          candidate.value.type === request.taskType &&
          candidate.value.queue.lane === request.lane &&
          candidate.value.requestedBy.kind === request.requestedBy.kind &&
          candidate.value.activeApprovalId == null &&
          candidate.value.activeCredentialCaptureId == null &&
          (!shouldDefer || candidate.value.state === 'deferred'),
      );

      if (shouldDefer) {
        if (!mergeCandidate) {
          const taskId = createRuntimeIdentifier('tsk');
          const progressSummary = createDeferredTaskProgressSummary({
            detail: `Waiting until ${request.dueAt}.`,
            lastActor: request.requestedBy.kind === 'schedule' ? 'scheduler' : 'head',
            requestedOutcome: request.requestedOutcome,
          });
          const task = withTaskProgressSummary(
            {
              id: taskId,
              recordType: 'task',
              schemaVersion: 1,
              createdAt: requestedAt,
              updatedAt: requestedAt,
              correlation: {
                ...request.correlation,
                taskId,
              },
              agentId: request.agentId,
              type: request.taskType,
              state: 'deferred',
              queue: {
                lane: request.lane,
                priority: request.priority,
              },
              requestedOutcome: request.requestedOutcome,
              requestedBy: request.requestedBy,
              dueAt: request.dueAt,
              stateEnteredAt: requestedAt,
              scheduleId: request.requestedBy.sourceScheduleId,
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
              externalReferences: request.externalReferences,
              notes: request.notes,
            },
            progressSummary,
            requestedAt,
          );
          const workingContext = buildDeferredWorkingContextUpdate(
            storedWorkingContext.value,
            taskId,
            requestedAt,
          );
          const idempotencyRecord: IdempotencyRecord = {
            id: createRuntimeIdentifier('idr'),
            recordType: 'idempotency_record',
            schemaVersion: 1,
            createdAt: requestedAt,
            updatedAt: requestedAt,
            correlation: {
              ...request.correlation,
              taskId,
            },
            agentId: request.agentId,
            scope: queueingScope,
            key: queueingIdempotencyKey,
            status: 'completed',
            resultReference: taskId,
            expiresAt: null,
          };
          await options.repositories.tasks.createDeferredTask({
            idempotencyRecord,
            task,
            workingContext,
            workingContextEtag: storedWorkingContext.etag,
          });

          return enqueueTaskResultSchema.parse({
            disposition: 'created_new_task',
            runJournalId: null,
            startRequest: null,
            taskEnvelopeId: null,
            taskId,
            taskState: 'deferred',
          });
        }

        const existingTask = mergeCandidate.value;
        const earliestDueAt =
          [existingTask.dueAt, request.dueAt]
            .filter((value): value is string => value != null)
            .sort()[0] ?? null;
        const mergedTask = withTaskProgressSummary(
          {
            ...existingTask,
            updatedAt: requestedAt,
            queue: mergeQueueDescriptor(existingTask.queue, request),
            requestedOutcome: request.requestedOutcome,
            dueAt: earliestDueAt,
            notes: mergeNotes(existingTask.notes, request.notes),
            externalReferences: mergeExternalReferences(
              existingTask.externalReferences,
              request.externalReferences,
            ),
            mergeKey,
          },
          createDeferredTaskProgressSummary({
            detail:
              earliestDueAt != null
                ? `Waiting until ${earliestDueAt}.`
                : 'Waiting until the due time.',
            lastActor: request.requestedBy.kind === 'schedule' ? 'scheduler' : 'head',
            requestedOutcome: request.requestedOutcome,
          }),
          requestedAt,
        );
        const workingContext = buildDeferredWorkingContextUpdate(
          storedWorkingContext.value,
          existingTask.id,
          requestedAt,
        );
        const idempotencyRecord: IdempotencyRecord = {
          id: createRuntimeIdentifier('idr'),
          recordType: 'idempotency_record',
          schemaVersion: 1,
          createdAt: requestedAt,
          updatedAt: requestedAt,
          correlation: {
            ...request.correlation,
            taskId: existingTask.id,
          },
          agentId: request.agentId,
          scope: queueingScope,
          key: queueingIdempotencyKey,
          status: 'completed',
          resultReference: existingTask.id,
          expiresAt: null,
        };
        await options.repositories.tasks.mergeDeferredTask({
          idempotencyRecord,
          task: mergedTask,
          taskEtag: mergeCandidate.etag,
          workingContext,
          workingContextEtag: storedWorkingContext.etag,
        });

        return enqueueTaskResultSchema.parse({
          disposition: 'merged_into_existing_task',
          runJournalId: mergedTask.currentRunJournalId,
          startRequest: null,
          taskEnvelopeId: mergedTask.activeTaskEnvelopeId,
          taskId: existingTask.id,
          taskState: 'deferred',
        });
      }

      if (!mergeCandidate) {
        const taskId = createRuntimeIdentifier('tsk');
        const progressSummary = createQueuedTaskProgressSummary({
          requestedOutcome: request.requestedOutcome,
        });
        const runJournal = buildInitialRunJournal({
          correlation: request.correlation,
          createdAt: requestedAt,
          request,
          summary: progressSummary,
          taskId,
        });
        const taskEnvelope: TaskEnvelope = {
          id: createRuntimeIdentifier('env'),
          recordType: 'task_envelope',
          schemaVersion: 1,
          createdAt: requestedAt,
          updatedAt: requestedAt,
          correlation: {
            ...request.correlation,
            taskId,
          },
          taskId,
          agentId: request.agentId,
          taskType: request.taskType,
          requestedOutcome: request.requestedOutcome,
          requestedBy: request.requestedBy,
          queue: {
            lane: request.lane,
            priority: request.priority,
          },
          dueAt: request.dueAt,
          sourceHeadTurnId: request.headTurnId,
          workingContextSummary: request.workingContextSummary,
          mergeKey,
          attemptNumber: 1,
          supersedesEnvelopeId: null,
          dispatchIdempotencyKey: null,
          approvalState: undefined,
          artifactIds: [],
          credentialIds: [],
          externalReferences: request.externalReferences,
          notes: request.notes,
        };
        const task = withTaskProgressSummary(
          {
            id: taskId,
            recordType: 'task',
            schemaVersion: 1,
            createdAt: requestedAt,
            updatedAt: requestedAt,
            correlation: {
              ...request.correlation,
              taskId,
            },
            agentId: request.agentId,
            type: request.taskType,
            state: 'queued',
            queue: taskEnvelope.queue,
            requestedOutcome: request.requestedOutcome,
            requestedBy: request.requestedBy,
            dueAt: request.dueAt,
            stateEnteredAt: requestedAt,
            scheduleId: request.requestedBy.sourceScheduleId,
            activeTaskEnvelopeId: taskEnvelope.id,
            currentRunJournalId: runJournal.id,
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
            externalReferences: request.externalReferences,
            notes: request.notes,
          },
          progressSummary,
          requestedAt,
        );
        const runJournalEntry = buildRunJournalEntry({
          agentId: request.agentId,
          correlation: request.correlation,
          createdAt: requestedAt,
          entryKind: 'status',
          journalId: runJournal.id,
          message: 'Queued new task from Head runtime.',
          progressSummary,
          taskId,
        });
        const workingContext = buildWorkingContextUpdate(storedWorkingContext.value, taskId, requestedAt);
        const idempotencyRecord: IdempotencyRecord = {
          id: createRuntimeIdentifier('idr'),
          recordType: 'idempotency_record',
          schemaVersion: 1,
          createdAt: requestedAt,
          updatedAt: requestedAt,
          correlation: {
            ...request.correlation,
            taskId,
          },
          agentId: request.agentId,
          scope: queueingScope,
          key: queueingIdempotencyKey,
          status: 'completed' as const,
          resultReference: taskId,
          expiresAt: null,
        };
        const created = await options.repositories.tasks.createTaskWithEnvelope({
          idempotencyRecord,
          runJournal,
          runJournalEntry,
          task,
          taskEnvelope,
          workingContext,
          workingContextEtag: storedWorkingContext.etag,
        });
        const startRequest =
          request.startRequested
            ? await this.requestQueuedTaskStart({
                agentId: request.agentId,
                correlation: {
                  ...request.correlation,
                  taskId,
                },
                taskId,
              })
            : null;

        return enqueueTaskResultSchema.parse({
          disposition: 'created_new_task',
          runJournalId: created.runJournal.value.id,
          startRequest,
          taskEnvelopeId: taskEnvelope.id,
          taskId,
          taskState: 'queued',
        });
      }

      const existingTask = mergeCandidate.value;
      const existingEnvelopeRecord = await getActiveEnvelope(existingTask);
      const existingEnvelope = existingEnvelopeRecord?.value ?? null;
      const existingJournal = await getActiveJournal(existingTask);
      const disposition: MergeDisposition =
        existingTask.state === 'deferred' ? 'requeued_existing_task' : 'merged_into_existing_task';
      const mergedTaskBase =
        existingTask.state === 'deferred'
          ? transitionTaskState(existingTask, 'queued', requestedAt)
          : {
              ...existingTask,
              updatedAt: requestedAt,
            };
      const earliestDueAt =
        [existingTask.dueAt, request.dueAt]
          .filter((value): value is string => value != null)
          .sort()[0] ?? null;
      const mergedTaskCandidate = withTaskProgressSummary(
        {
          ...mergedTaskBase,
          queue: mergeQueueDescriptor(existingTask.queue, request),
          requestedOutcome: request.requestedOutcome,
          dueAt: earliestDueAt,
          notes: mergeNotes(existingTask.notes, request.notes),
          externalReferences: mergeExternalReferences(
            existingTask.externalReferences,
            request.externalReferences,
          ),
          mergeKey,
          attemptCount:
            disposition === 'requeued_existing_task'
              ? existingTask.attemptCount + 1
              : existingTask.attemptCount,
        },
        createQueuedTaskProgressSummary({
          requestedOutcome: request.requestedOutcome,
          detail:
            disposition === 'requeued_existing_task'
              ? 'Re-queued after being deferred.'
              : 'Merged into an existing queued task.',
        }),
        requestedAt,
      );
      const replacementEnvelopeNeeded = shouldCreateReplacementEnvelope({
        existingEnvelope,
        existingTask,
        request,
        task: mergedTaskCandidate,
      });
      const mergedTask =
        disposition === 'requeued_existing_task' || replacementEnvelopeNeeded
          ? resetTaskLaunchState(mergedTaskCandidate, requestedAt)
          : mergedTaskCandidate;
      const replacementEnvelope: TaskEnvelope | undefined = replacementEnvelopeNeeded
        ? {
            id: createRuntimeIdentifier('env'),
            recordType: 'task_envelope',
            schemaVersion: 1,
            createdAt: requestedAt,
            updatedAt: requestedAt,
            correlation: {
              ...request.correlation,
              taskId: existingTask.id,
            },
            taskId: existingTask.id,
            agentId: request.agentId,
            taskType: request.taskType,
            requestedOutcome: mergedTask.requestedOutcome,
            requestedBy: mergedTask.requestedBy,
            queue: mergedTask.queue,
            dueAt: mergedTask.dueAt,
            sourceHeadTurnId: request.headTurnId,
            workingContextSummary: request.workingContextSummary,
            mergeKey,
            attemptNumber:
              disposition === 'requeued_existing_task'
                ? existingTask.attemptCount + 1
                : existingEnvelope?.attemptNumber ?? existingTask.attemptCount,
            supersedesEnvelopeId: existingEnvelope?.id ?? null,
            dispatchIdempotencyKey: null,
            approvalState: existingEnvelope?.approvalState,
            artifactIds: existingEnvelope?.artifactIds ?? [],
            credentialIds: existingEnvelope?.credentialIds ?? [],
            externalReferences: mergedTask.externalReferences,
            notes: mergedTask.notes,
          }
        : undefined;
      const runJournal =
        existingJournal?.value != null
          ? {
              ...existingJournal.value,
              updatedAt: requestedAt,
              summary: mergedTask.progressSummary?.headline ?? existingJournal.value.summary,
              progressSummary: mergedTask.progressSummary,
              lastEntryAt: requestedAt,
            }
          : buildInitialRunJournal({
              correlation: request.correlation,
              createdAt: requestedAt,
              request,
              summary: mergedTask.progressSummary,
              taskId: existingTask.id,
            });
      const finalTask: Task = {
        ...mergedTask,
        activeTaskEnvelopeId:
          replacementEnvelope?.id ?? existingTask.activeTaskEnvelopeId ?? null,
        currentRunJournalId: runJournal.id,
      };
      const runJournalEntry = buildRunJournalEntry({
        agentId: request.agentId,
        correlation: request.correlation,
        createdAt: requestedAt,
        entryKind: disposition === 'requeued_existing_task' ? 'status' : 'action',
        journalId: runJournal.id,
        message:
          disposition === 'requeued_existing_task'
            ? 'Re-queued deferred task.'
            : 'Merged duplicate task request into existing queued work.',
        progressSummary: finalTask.progressSummary,
        taskId: existingTask.id,
      });
      const workingContext = buildWorkingContextUpdate(
        storedWorkingContext.value,
        existingTask.id,
        requestedAt,
      );
      const idempotencyRecord: IdempotencyRecord = {
        id: createRuntimeIdentifier('idr'),
        recordType: 'idempotency_record',
        schemaVersion: 1,
        createdAt: requestedAt,
        updatedAt: requestedAt,
        correlation: {
          ...request.correlation,
          taskId: existingTask.id,
        },
        agentId: request.agentId,
        scope: queueingScope,
        key: queueingIdempotencyKey,
        status: 'completed' as const,
        resultReference: existingTask.id,
        expiresAt: null,
      };
      await options.repositories.tasks.mergeTaskIntoQueue({
        idempotencyRecord,
        runJournal,
        ...(existingJournal?.etag ? { runJournalEtag: existingJournal.etag } : {}),
        runJournalEntry,
        task: finalTask,
        taskEtag: mergeCandidate.etag,
        ...(replacementEnvelope ? { taskEnvelope: replacementEnvelope } : {}),
        workingContext,
        workingContextEtag: storedWorkingContext.etag,
      });
      const startRequest =
        request.startRequested
          ? await this.requestQueuedTaskStart({
              agentId: request.agentId,
              correlation: {
                ...request.correlation,
                taskId: existingTask.id,
              },
              taskId: existingTask.id,
            })
          : null;

      return enqueueTaskResultSchema.parse({
        disposition,
        runJournalId: runJournal.id,
        startRequest,
        taskEnvelopeId: finalTask.activeTaskEnvelopeId,
        taskId: existingTask.id,
        taskState: finalTask.state,
      });
    },

    async activateDeferredTask(
      input: EnqueueTaskRequest & {
        taskId: string;
      },
    ): Promise<EnqueueTaskResult> {
      const request = enqueueTaskRequestSchema
        .extend({
          taskId: requestQueuedTaskStartRequestSchema.shape.taskId,
        })
        .parse(input);
      const requestedAt = clock();
      const queueingIdempotencyKey = createTaskCreationIdempotencyKey(
        request.agentId,
        request.requestedOutcome,
        request.dueAt,
        request.taskType,
        request.headTurnId ?? request.taskId,
      );
      const queueingScope = getQueueingScope(request);
      const replay = await options.repositories.idempotency.getByScopeAndKey(
        request.agentId,
        queueingScope,
        queueingIdempotencyKey,
      );

      if (replay?.value.resultReference) {
        const replayTask = await options.repositories.tasks.getTask(request.agentId, request.taskId);
        if (!replayTask) {
          throw new ConflictError('The deferred-task activation record references a missing task.');
        }

        return enqueueTaskResultSchema.parse({
          disposition: replayTask.value.state === 'queued' ? 'requeued_existing_task' : 'merged_into_existing_task',
          runJournalId: replayTask.value.currentRunJournalId,
          startRequest: null,
          taskEnvelopeId: replayTask.value.activeTaskEnvelopeId,
          taskId: replayTask.value.id,
          taskState: replayTask.value.state,
        });
      }

      const storedTask = await options.repositories.tasks.getTask(request.agentId, request.taskId);
      if (!storedTask) {
        throw new NotFoundError('Deferred task not found.');
      }

      if (storedTask.value.state !== 'deferred') {
        throw new ConflictError('Only deferred tasks can be activated through the due-task path.');
      }

      const storedWorkingContext = await getWorkingContext(request.agentId, request.workingContextId);
      const mergedExternalReferences = mergeExternalReferences(
        storedTask.value.externalReferences,
        request.externalReferences,
      );
      const mergeKey = createTaskMergeKey({
        agentId: request.agentId,
        dueAt: storedTask.value.dueAt,
        externalReferences: mergedExternalReferences,
        requestedByKind: storedTask.value.requestedBy.kind,
        requestedOutcome: request.requestedOutcome,
        taskType: request.taskType,
      });
      const progressSummary = createQueuedTaskProgressSummary({
        detail: 'Activated after due-task review.',
        requestedOutcome: request.requestedOutcome,
      });
      const runJournal = buildInitialRunJournal({
        correlation: request.correlation,
        createdAt: requestedAt,
        request: {
          ...request,
          requestedBy: storedTask.value.requestedBy,
        },
        summary: progressSummary,
        taskId: storedTask.value.id,
      });
      const taskEnvelope: TaskEnvelope = {
        id: createRuntimeIdentifier('env'),
        recordType: 'task_envelope',
        schemaVersion: 1,
        createdAt: requestedAt,
        updatedAt: requestedAt,
        correlation: {
          ...request.correlation,
          taskId: storedTask.value.id,
        },
        taskId: storedTask.value.id,
        agentId: request.agentId,
        taskType: request.taskType,
        requestedOutcome: request.requestedOutcome,
        requestedBy: storedTask.value.requestedBy,
        queue: mergeQueueDescriptor(storedTask.value.queue, request),
        dueAt: storedTask.value.dueAt,
        sourceHeadTurnId: request.headTurnId,
        workingContextSummary: request.workingContextSummary,
        mergeKey,
        attemptNumber: storedTask.value.attemptCount + 1,
        supersedesEnvelopeId: storedTask.value.activeTaskEnvelopeId,
        dispatchIdempotencyKey: null,
        approvalState: undefined,
        artifactIds: [],
        credentialIds: [],
        externalReferences: mergedExternalReferences,
        notes: mergeNotes(storedTask.value.notes, request.notes),
      };
      const task = withTaskProgressSummary(
        {
          ...transitionTaskState(storedTask.value, 'queued', requestedAt),
          updatedAt: requestedAt,
          type: request.taskType,
          queue: taskEnvelope.queue,
          requestedOutcome: request.requestedOutcome,
          dueAt: storedTask.value.dueAt,
          activeTaskEnvelopeId: taskEnvelope.id,
          currentRunJournalId: runJournal.id,
          currentHandsRunId: null,
          mergeKey,
          attemptCount: storedTask.value.attemptCount + 1,
          launchState: createDefaultTaskLaunchState(),
          externalReferences: mergedExternalReferences,
          notes: taskEnvelope.notes,
        },
        progressSummary,
        requestedAt,
      );
      const runJournalEntry = buildRunJournalEntry({
        agentId: request.agentId,
        correlation: request.correlation,
        createdAt: requestedAt,
        entryKind: 'status',
        journalId: runJournal.id,
        message: 'Activated deferred task from a due-task Head turn.',
        progressSummary,
        taskId: storedTask.value.id,
      });
      const workingContext = buildWorkingContextUpdate(
        storedWorkingContext.value,
        storedTask.value.id,
        requestedAt,
      );
      const idempotencyRecord: IdempotencyRecord = {
        id: createRuntimeIdentifier('idr'),
        recordType: 'idempotency_record',
        schemaVersion: 1,
        createdAt: requestedAt,
        updatedAt: requestedAt,
        correlation: {
          ...request.correlation,
          taskId: storedTask.value.id,
        },
        agentId: request.agentId,
        scope: queueingScope,
        key: queueingIdempotencyKey,
        status: 'completed',
        resultReference: storedTask.value.id,
        expiresAt: null,
      };
      const activated = await options.repositories.tasks.activateDeferredTask({
        idempotencyRecord,
        runJournal,
        runJournalEntry,
        task,
        taskEtag: storedTask.etag,
        taskEnvelope,
        workingContext,
        workingContextEtag: storedWorkingContext.etag,
      });
      const startRequest =
        request.startRequested
          ? await this.requestQueuedTaskStart({
              agentId: request.agentId,
              correlation: {
                ...request.correlation,
                taskId: storedTask.value.id,
              },
              taskId: storedTask.value.id,
            })
          : null;

      return enqueueTaskResultSchema.parse({
        disposition: 'requeued_existing_task',
        runJournalId: activated.runJournal.value.id,
        startRequest,
        taskEnvelopeId: activated.taskEnvelope?.value.id ?? taskEnvelope.id,
        taskId: storedTask.value.id,
        taskState: 'queued',
      });
    },

    async requestQueuedTaskStart(
      input: RequestQueuedTaskStartRequest,
    ): Promise<RequestQueuedTaskStartResult> {
      const request = requestQueuedTaskStartRequestSchema.parse(input);
      const requestedAt = request.requestedAt ?? clock();
      const storedTask = await options.repositories.tasks.getTask(request.agentId, request.taskId);
      if (!storedTask) {
        throw new NotFoundError('Queued task not found.');
      }

      if (storedTask.value.state !== 'queued') {
        throw new ConflictError('Only queued tasks can request Hands startup.');
      }

      if (!storedTask.value.activeTaskEnvelopeId) {
        throw new ConflictError('Queued task does not have an active task envelope.');
      }

      const storedEnvelope = await options.repositories.tasks.getTaskEnvelope(
        request.agentId,
        storedTask.value.activeTaskEnvelopeId,
      );
      if (!storedEnvelope) {
        throw new NotFoundError('Active task envelope not found.');
      }

      const idempotencyKey = createTaskStartRequestIdempotencyKey(
        storedTask.value.id,
        storedEnvelope.value.id,
        storedEnvelope.value.attemptNumber,
      );
      const existingIdempotency = await options.repositories.idempotency.getByScopeAndKey(
        request.agentId,
        START_REQUEST_SCOPE,
        idempotencyKey,
      );

      if (existingIdempotency) {
        return requestQueuedTaskStartResultSchema.parse({
          adapterAccepted: storedTask.value.launchState.status === 'requested',
          attempted: false,
          errorCode: storedTask.value.launchState.lastErrorCode ?? null,
          errorMessage: storedTask.value.launchState.lastErrorMessage ?? null,
          replayed: true,
          taskEnvelopeId: storedEnvelope.value.id,
          taskId: storedTask.value.id,
        });
      }

      const reservedIdempotencyRecord: IdempotencyRecord = {
        id: createRuntimeIdentifier('idr'),
        recordType: 'idempotency_record',
        schemaVersion: 1,
        createdAt: requestedAt,
        updatedAt: requestedAt,
        correlation: {
          ...request.correlation,
          taskId: storedTask.value.id,
        },
        agentId: request.agentId,
        scope: START_REQUEST_SCOPE,
        key: idempotencyKey,
        status: 'reserved',
        resultReference: storedTask.value.id,
        expiresAt: null,
      };
      const reserved = await options.repositories.tasks.recordTaskLaunchRequest({
        idempotencyRecord: reservedIdempotencyRecord,
        task: markTaskLaunchRequested(storedTask.value, requestedAt, idempotencyKey),
        taskEtag: storedTask.etag,
        taskEnvelope: {
          ...storedEnvelope.value,
          updatedAt: requestedAt,
          dispatchIdempotencyKey: idempotencyKey,
        },
        taskEnvelopeEtag: storedEnvelope.etag,
      });

      try {
        const handsDispatch = await options.handsJobs.startRun({
          agentId: request.agentId,
          attemptNumber: storedEnvelope.value.attemptNumber,
          correlation: {
            ...request.correlation,
            taskId: storedTask.value.id,
          },
          dispatchIdempotencyKey: idempotencyKey,
          taskEnvelopeId: storedEnvelope.value.id,
          taskId: storedTask.value.id,
        });

        await options.repositories.tasks.completeTaskLaunchRequest({
          idempotencyRecord: {
            ...reserved.idempotencyRecord.value,
            status: 'completed',
            updatedAt: clock(),
            resultReference: handsDispatch.dispatchReference,
          },
          idempotencyRecordEtag: reserved.idempotencyRecord.etag,
          task: reserved.task.value,
          taskEtag: reserved.task.etag,
          taskEnvelope: reserved.taskEnvelope.value,
          taskEnvelopeEtag: reserved.taskEnvelope.etag,
        });

        return requestQueuedTaskStartResultSchema.parse({
          adapterAccepted: true,
          attempted: true,
          errorCode: null,
          errorMessage: null,
          replayed: false,
          taskEnvelopeId: storedEnvelope.value.id,
          taskId: storedTask.value.id,
        });
      } catch (error) {
        const failure = mapQueueStartError(error);

        await options.repositories.tasks.completeTaskLaunchRequest({
          idempotencyRecord: {
            ...reserved.idempotencyRecord.value,
            status: 'completed',
            updatedAt: clock(),
            resultReference: storedTask.value.id,
          },
          idempotencyRecordEtag: reserved.idempotencyRecord.etag,
          task: markTaskLaunchFailed(reserved.task.value, clock(), failure.code, failure.message),
          taskEtag: reserved.task.etag,
          taskEnvelope: reserved.taskEnvelope.value,
          taskEnvelopeEtag: reserved.taskEnvelope.etag,
        });
        options.logger.warn('task_queue.start_request_failed', {
          agentId: request.agentId,
          message: failure.message,
          taskId: storedTask.value.id,
        });

        return requestQueuedTaskStartResultSchema.parse({
          adapterAccepted: false,
          attempted: true,
          errorCode: failure.code,
          errorMessage: failure.message,
          replayed: false,
          taskEnvelopeId: storedEnvelope.value.id,
          taskId: storedTask.value.id,
        });
      }
    },

    async getTaskStatusSnapshot(input: {
      agentId: string;
      workingContextId: string;
    }): Promise<TaskStatusSnapshot> {
      const storedWorkingContext = await getWorkingContext(input.agentId, input.workingContextId);
      const openTaskIds =
        storedWorkingContext.value.openTaskIds.length > 0
          ? storedWorkingContext.value.openTaskIds
          : (await options.repositories.tasks.listOpenTasks(input.agentId)).map((task) => task.value.id);
      const openTasks = await buildStatusItems(openTaskIds, input.agentId);
      const schedules = await options.repositories.schedules.listByAgent(input.agentId, ['active']);
      const pendingApprovalItems = (
        await Promise.all(
          storedWorkingContext.value.pendingApprovalIds.map((approvalId) =>
            options.repositories.approvals.findById(approvalId),
          ),
        )
      )
        .filter((approval): approval is StoredRecord<Approval> => approval != null)
        .map((approval) => ({
          approvalId: approval.value.id,
          category: approval.value.category,
          expiresAt: approval.value.expiresAt,
          requestedAt: approval.value.requestedAt,
          state: approval.value.state,
          stepUpRequired: approval.value.stepUpRequired,
          summary: approval.value.summary,
          taskId: approval.value.taskId,
        }));
      const pendingCredentialCaptureItems = (
        await Promise.all(
          storedWorkingContext.value.pendingCredentialCaptureIds.map((credentialCaptureId) =>
            options.repositories.credentialCaptures.findById(credentialCaptureId),
          ),
        )
      )
        .filter((capture): capture is StoredRecord<CredentialCapture> => capture != null)
        .map((capture) => ({
          alias: capture.value.alias,
          credentialCaptureId: capture.value.id,
          displayName: capture.value.displayName,
          expiresAt: capture.value.expiresAt,
          provider: capture.value.provider,
          reason: capture.value.reason,
          requestedAt: capture.value.requestedAt,
          state: capture.value.state,
          taskId: capture.value.taskId,
          willResumeTask: capture.value.taskId != null,
        }));

      return taskStatusSnapshotSchema.parse({
        activeTaskId: storedWorkingContext.value.activeTaskId,
        openTasks,
        pendingApprovalIds: storedWorkingContext.value.pendingApprovalIds,
        pendingApprovalItems,
        pendingCredentialCaptureIds: storedWorkingContext.value.pendingCredentialCaptureIds,
        pendingCredentialCaptureItems,
        schedules: schedules.map((schedule) => ({
          description: schedule.value.description,
          nextDueAt: schedule.value.nextDueAt,
          scheduleId: schedule.value.id,
          state: schedule.value.state,
        })),
        workingContextId: storedWorkingContext.value.id,
        workingContextSummary: storedWorkingContext.value.summary,
      });
    },
  };
}

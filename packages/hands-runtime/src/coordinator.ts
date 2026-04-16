import {
  handsRunExecutionResultSchema,
  handsStartRunRequestSchema,
  type HandsRun,
  type HandsRunExecutionResult,
  type HandsStartRunRequest,
  type RunJournal,
  type TaskProgressSummary,
} from '@echidna-claw/contracts';
import {
  applyHandsEventToWorkingContext,
  assertSupportedHandsTaskType,
  buildHandsProgressSummary,
  transitionTaskState,
} from '@echidna-claw/domain';

import { createDefaultHandlers } from './default-handlers.js';
import { ActiveHandsRunSession, HandsCancellationError } from './session.js';
import type {
  ActiveExecutionState,
  HandsExecutionCoordinator,
  HandsExecutionCoordinatorOptions,
} from './types.js';

function createRuntimeIdentifier(prefix: 'hnd' | 'rje' | 'rjn'): string {
  return `${prefix}_${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;
}

function buildRuntimeSummary(requestedOutcome: string): string {
  return `Hands is working on: ${requestedOutcome}`;
}

function buildHandsRunRecord(input: {
  attemptNumber: number;
  claimedAt: string;
  correlation: HandsStartRunRequest['correlation'];
  dispatchIdempotencyKey: string;
  taskId: string;
  taskEnvelopeId: string;
  taskAgentId: string;
  workerInstanceId: string;
}): HandsRun {
  const handsRunId = createRuntimeIdentifier('hnd');

  return {
    id: handsRunId,
    recordType: 'hands_run',
    schemaVersion: 1,
    createdAt: input.claimedAt,
    updatedAt: input.claimedAt,
    correlation: {
      ...input.correlation,
      handsRunId,
      taskId: input.taskId,
    },
    agentId: input.taskAgentId,
    attemptNumber: input.attemptNumber,
    cancellationRequestedAt: null,
    cancelledAt: null,
    claimedAt: input.claimedAt,
    completedAt: null,
    dispatchIdempotencyKey: input.dispatchIdempotencyKey,
    failureCode: null,
    failureMessage: null,
    lastHeartbeatAt: input.claimedAt,
    releasedAt: null,
    resultCode: null,
    startedAt: input.claimedAt,
    state: 'running',
    taskEnvelopeId: input.taskEnvelopeId,
    taskId: input.taskId,
    workerInstanceId: input.workerInstanceId,
  };
}

function buildHandsRunJournal(input: {
  claimedAt: string;
  correlation: HandsStartRunRequest['correlation'];
  handsRun: HandsRun;
  progressSummary: TaskProgressSummary;
  taskId: string;
}): RunJournal {
  return {
    id: createRuntimeIdentifier('rjn'),
    recordType: 'run_journal',
    schemaVersion: 1,
    createdAt: input.claimedAt,
    updatedAt: input.claimedAt,
    correlation: {
      ...input.correlation,
      handsRunId: input.handsRun.id,
      taskId: input.taskId,
    },
    agentId: input.handsRun.agentId,
    closedAt: null,
    handsRunId: input.handsRun.id,
    lastEntryAt: input.claimedAt,
    openedAt: input.claimedAt,
    progressSummary: input.progressSummary,
    resultCode: null,
    scope: 'hands_run',
    scopeId: input.handsRun.id,
    status: 'open',
    summary: input.progressSummary.headline,
    taskId: input.taskId,
  };
}

export function createHandsExecutionCoordinator(
  options: HandsExecutionCoordinatorOptions,
): HandsExecutionCoordinator {
  const handlers = options.handlers ?? createDefaultHandlers();
  const clock = options.now ?? (() => new Date().toISOString());

  return {
    async executeDispatchedRun(input: HandsStartRunRequest): Promise<HandsRunExecutionResult> {
      const request = handsStartRunRequestSchema.parse(input);
      const storedTask = await options.repositories.tasks.getTask(request.agentId, request.taskId);
      if (!storedTask) {
        return handsRunExecutionResultSchema.parse({
          handsRunId: null,
          resultCode: null,
          startupOutcome: 'stale_dispatch',
          summary: 'The dispatched task no longer exists.',
          taskId: request.taskId,
          taskState: null,
        });
      }

      const replayedRun = await options.repositories.execution.findHandsRunByDispatchKey(
        storedTask.value.agentId,
        request.dispatchIdempotencyKey,
      );
      if (replayedRun) {
        return handsRunExecutionResultSchema.parse({
          handsRunId: replayedRun.value.id,
          resultCode: replayedRun.value.resultCode,
          startupOutcome: 'replayed_existing_run',
          summary: 'The Hands start request was already claimed.',
          taskId: request.taskId,
          taskState: storedTask.value.state,
        });
      }

      if (
        storedTask.value.state !== 'queued' ||
        storedTask.value.activeTaskEnvelopeId !== request.taskEnvelopeId ||
        storedTask.value.cancellationRequestedAt != null
      ) {
        return handsRunExecutionResultSchema.parse({
          handsRunId: null,
          resultCode: null,
          startupOutcome: 'stale_dispatch',
          summary: 'The dispatched task is no longer claimable.',
          taskId: request.taskId,
          taskState: storedTask.value.state,
        });
      }

      const storedEnvelope = await options.repositories.tasks.getTaskEnvelope(
        storedTask.value.agentId,
        request.taskEnvelopeId,
      );
      if (
        !storedEnvelope ||
        storedEnvelope.value.attemptNumber !== request.attemptNumber ||
        storedEnvelope.value.dispatchIdempotencyKey !== request.dispatchIdempotencyKey
      ) {
        return handsRunExecutionResultSchema.parse({
          handsRunId: null,
          resultCode: null,
          startupOutcome: 'stale_dispatch',
          summary: 'The active task envelope no longer matches the dispatch request.',
          taskId: request.taskId,
          taskState: storedTask.value.state,
        });
      }

      const activeRuns = await options.repositories.execution.listActiveHandsRuns(
        storedTask.value.agentId,
      );
      if (activeRuns.length > 0) {
        return handsRunExecutionResultSchema.parse({
          handsRunId: null,
          resultCode: null,
          startupOutcome: 'agent_busy',
          summary: 'Another Hands run is already active for this agent.',
          taskId: request.taskId,
          taskState: storedTask.value.state,
        });
      }

      const storedWorkingContext = await options.repositories.workingContexts.getByAgent(
        storedTask.value.agentId,
      );
      const storedAgent = await options.repositories.agents.get(storedTask.value.agentId);
      if (!storedWorkingContext || !storedAgent) {
        return handsRunExecutionResultSchema.parse({
          handsRunId: null,
          resultCode: null,
          startupOutcome: 'claim_failed',
          summary: 'Hands could not load the agent execution context.',
          taskId: request.taskId,
          taskState: storedTask.value.state,
        });
      }

      assertSupportedHandsTaskType(storedTask.value.type);

      const claimedAt = clock();
      const progressSummary = buildHandsProgressSummary({
        headline: buildRuntimeSummary(storedTask.value.requestedOutcome),
        percentComplete: 0,
      });
      const handsRun = buildHandsRunRecord({
        attemptNumber: request.attemptNumber,
        claimedAt,
        correlation: request.correlation,
        dispatchIdempotencyKey: request.dispatchIdempotencyKey,
        taskAgentId: storedTask.value.agentId,
        taskEnvelopeId: request.taskEnvelopeId,
        taskId: storedTask.value.id,
        workerInstanceId: options.workerInstanceId,
      });
      const runJournal = buildHandsRunJournal({
        claimedAt,
        correlation: request.correlation,
        handsRun,
        progressSummary,
        taskId: storedTask.value.id,
      });
      const claimed = await options.repositories.execution.claimTaskForHandsRun({
        handsRun,
        runJournal,
        runJournalEntry: {
          id: createRuntimeIdentifier('rje'),
          recordType: 'run_journal_entry',
          schemaVersion: 1,
          createdAt: claimedAt,
          updatedAt: claimedAt,
          correlation: {
            ...request.correlation,
            taskId: storedTask.value.id,
          },
          agentId: storedTask.value.agentId,
          approvalId: null,
          artifactIds: [],
          entryKind: 'status',
          journalId: runJournal.id,
          level: 'info',
          message: 'Hands claimed queued work.',
          progressSummaryPatch: progressSummary,
          recordedAt: claimedAt,
          taskStateAfter: 'running',
        },
        task: {
          ...transitionTaskState(storedTask.value, 'running', claimedAt),
          currentHandsRunId: handsRun.id,
          currentRunJournalId: runJournal.id,
          lastProgressAt: claimedAt,
          progressSummary,
          updatedAt: claimedAt,
        },
        taskEtag: storedTask.etag,
        workingContext: applyHandsEventToWorkingContext({
          latestHandsStatus: progressSummary.headline,
          summaryUpdatedAt: claimedAt,
          taskId: storedTask.value.id,
          workingContext: storedWorkingContext.value,
        }),
        workingContextEtag: storedWorkingContext.etag,
      });
      const state: ActiveExecutionState = {
        agent: storedAgent,
        handsRun: claimed.handsRun,
        runJournal: claimed.runJournal,
        task: claimed.task,
        taskEnvelope: storedEnvelope,
        workingContext: claimed.workingContext,
      };
      const session = new ActiveHandsRunSession(options, request, state);

      try {
        await session.checkpoint('after_claim');
        const handler = handlers.find((candidate) => candidate.canHandle(storedTask.value.type));
        if (!handler) {
          return session.finalizeOutcome({
            artifactIds: [],
            failureCode: 'unsupported_task_type',
            failureMessage: `No Hands handler is registered for '${storedTask.value.type}'.`,
            followUpTasks: [],
            kind: 'failed',
            retryable: false,
            summary: `Hands cannot execute task type '${storedTask.value.type}'.`,
          });
        }

        return await session.finalizeOutcome(await handler.execute(session.buildContext()));
      } catch (error) {
        if (error instanceof HandsCancellationError) {
          return error.result;
        }

        options.logger.error('hands_runtime.execution_failed', {
          message: error instanceof Error ? error.message : 'Unknown Hands execution failure.',
          taskId: request.taskId,
        });
        return session.failUnexpected(error);
      }
    },
  };
}

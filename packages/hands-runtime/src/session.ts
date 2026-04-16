import {
  enqueueTaskResultSchema,
  handsCancellationSnapshotSchema,
  handsEnqueueFollowUpRequestSchema,
  handsHandlerOutcomeSchema,
  handsHandlerProgressUpdateSchema,
  handsRunExecutionResultSchema,
  sandboxCloseSessionRequestSchema,
  sandboxCreateSessionRequestSchema,
  sandboxExecuteCommandRequestSchema,
  type EnqueueTaskResult,
  type HandsFollowUpTaskRequest,
  type HandsHandlerOutcome,
  type HandsHandlerProgressUpdate,
  type HandsRunExecutionResult,
  type HandsStartRunRequest,
  type RunJournalEntry,
  type SandboxCloseSessionRequest,
  type Task,
  type TaskProgressSummary,
} from '@echidna-claw/contracts';
import {
  applyHandsEventToWorkingContext,
  buildHandsProgressSummary,
  createHandsCancellationSnapshot,
  transitionHandsRunState,
  transitionTaskState,
} from '@echidna-claw/domain';
import type { ExecutionRepository } from '@echidna-claw/persistence';

import type {
  ActiveExecutionState,
  HandsExecutionCoordinatorOptions,
  HandsTaskHandlerContext,
  HandsTaskSandboxClient,
} from './types.js';

export class HandsCancellationError extends Error {
  constructor(public readonly result: HandsRunExecutionResult) {
    super(result.summary);
  }
}

function createRuntimeIdentifier(prefix: 'rje' | 'sbx'): string {
  return `${prefix}_${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;
}

function buildJournalEntry(input: {
  agentId: string;
  correlation: HandsStartRunRequest['correlation'];
  entryKind: RunJournalEntry['entryKind'];
  handsActionSummary?: string;
  journalId: string;
  level?: RunJournalEntry['level'];
  message: string;
  progressSummaryPatch?: TaskProgressSummary | null;
  recordedAt: string;
  taskId: string;
  taskStateAfter?: Task['state'] | null;
}): RunJournalEntry {
  return {
    id: createRuntimeIdentifier('rje'),
    recordType: 'run_journal_entry',
    schemaVersion: 1,
    createdAt: input.recordedAt,
    updatedAt: input.recordedAt,
    correlation: {
      ...input.correlation,
      taskId: input.taskId,
    },
    agentId: input.agentId,
    approvalId: null,
    artifactIds: [],
    entryKind: input.entryKind,
    ...(input.handsActionSummary != null ? { handsActionSummary: input.handsActionSummary } : {}),
    journalId: input.journalId,
    level: input.level ?? 'info',
    message: input.message,
    progressSummaryPatch: input.progressSummaryPatch ?? null,
    recordedAt: input.recordedAt,
    taskStateAfter: input.taskStateAfter ?? null,
  };
}

function buildTerminalProgressSummary(outcome: HandsHandlerOutcome): TaskProgressSummary {
  switch (outcome.kind) {
    case 'waiting_for_user':
      return buildHandsProgressSummary({
        detail: outcome.openQuestions.join(' '),
        headline: outcome.summary,
        waitingForUser: true,
      });
    case 'deferred':
      return buildHandsProgressSummary({
        detail: `Deferred until ${outcome.dueAt}.`,
        headline: outcome.summary,
      });
    default:
      return buildHandsProgressSummary(
        outcome.kind === 'completed'
          ? {
              headline: outcome.summary,
              percentComplete: 100,
            }
          : {
              headline: outcome.summary,
            },
      );
  }
}

export class ActiveHandsRunSession {
  private readonly openSandboxSessionIds = new Set<string>();

  constructor(
    private readonly options: HandsExecutionCoordinatorOptions,
    private readonly startRequest: HandsStartRunRequest,
    private state: ActiveExecutionState,
  ) {}

  buildContext(): HandsTaskHandlerContext {
    return {
      agent: this.state.agent.value,
      checkpoint: async (label) => {
        await this.checkpoint(label);
      },
      enqueueFollowUpTask: async (request) => this.enqueueFollowUpTask(request),
      handsRun: this.state.handsRun.value,
      reportProgress: async (update) => {
        await this.reportProgress(update);
      },
      sandbox: this.createSandboxFacade(),
      task: this.state.task.value,
      taskEnvelope: this.state.taskEnvelope.value,
    };
  }

  async checkpoint(label: string): Promise<void> {
    const reloadedTask = await this.options.repositories.tasks.getTask(
      this.state.task.value.agentId,
      this.state.task.value.id,
    );
    if (!reloadedTask) {
      throw new Error(`Task '${this.state.task.value.id}' was not found during checkpoint '${label}'.`);
    }

    const checkpointedAt = this.now();
    const task = {
      ...reloadedTask.value,
      currentHandsRunId: this.state.handsRun.value.id,
      currentRunJournalId: this.state.runJournal.value.id,
      lastCheckpointAt: checkpointedAt,
      updatedAt: checkpointedAt,
    };
    const snapshot = handsCancellationSnapshotSchema.parse(createHandsCancellationSnapshot(task));
    if (snapshot.requestedAt != null) {
      this.state = {
        ...this.state,
        task: {
          ...reloadedTask,
          value: task,
        },
      };
      const result = await this.finalizeOutcome({
        kind: 'cancelled',
        resultCode: 'cancelled',
        summary:
          snapshot.reason != null && snapshot.reason.trim() !== ''
            ? `Cancelled: ${snapshot.reason}`
            : 'Cancelled before the next Hands checkpoint.',
      });
      throw new HandsCancellationError(result);
    }

    const updated = await this.options.repositories.execution.updateHandsRunExecution({
      handsRun: {
        ...this.state.handsRun.value,
        cancellationRequestedAt: task.cancellationRequestedAt,
        lastHeartbeatAt: checkpointedAt,
        updatedAt: checkpointedAt,
      },
      handsRunEtag: this.state.handsRun.etag,
      runJournal: {
        ...this.state.runJournal.value,
        updatedAt: checkpointedAt,
      },
      runJournalEtag: this.state.runJournal.etag,
      task,
      taskEtag: reloadedTask.etag,
      workingContext: {
        ...this.state.workingContext.value,
        updatedAt: checkpointedAt,
      },
      workingContextEtag: this.state.workingContext.etag,
    });
    this.syncState(updated);
  }

  async reportProgress(update: HandsHandlerProgressUpdate): Promise<void> {
    const parsed = handsHandlerProgressUpdateSchema.parse(update);
    const reportedAt = this.now();
    const progressSummary = buildHandsProgressSummary({
      headline: parsed.headline ?? parsed.message,
      ...(parsed.detail != null ? { detail: parsed.detail } : {}),
      ...(parsed.percentComplete != null ? { percentComplete: parsed.percentComplete } : {}),
      waitingForUser: parsed.waitingForUser,
    });
    const updated = await this.options.repositories.execution.updateHandsRunExecution({
      handsRun: {
        ...this.state.handsRun.value,
        lastHeartbeatAt: reportedAt,
        updatedAt: reportedAt,
      },
      handsRunEtag: this.state.handsRun.etag,
      runJournal: {
        ...this.state.runJournal.value,
        lastEntryAt: reportedAt,
        progressSummary,
        summary: progressSummary.headline,
        updatedAt: reportedAt,
      },
      runJournalEntry: buildJournalEntry({
        agentId: this.state.task.value.agentId,
        correlation: this.startRequest.correlation,
        entryKind: parsed.entryKind,
        journalId: this.state.runJournal.value.id,
        level: parsed.level,
        message: parsed.message,
        progressSummaryPatch: progressSummary,
        recordedAt: reportedAt,
        taskId: this.state.task.value.id,
        taskStateAfter: this.state.task.value.state,
        ...(parsed.handsActionSummary != null
          ? { handsActionSummary: parsed.handsActionSummary }
          : {}),
      }),
      runJournalEtag: this.state.runJournal.etag,
      task: {
        ...this.state.task.value,
        lastProgressAt: reportedAt,
        progressSummary,
        updatedAt: reportedAt,
      },
      taskEtag: this.state.task.etag,
      workingContext: applyHandsEventToWorkingContext({
        latestHandsStatus: parsed.headline ?? parsed.message,
        openQuestions: this.state.workingContext.value.openQuestions,
        summaryUpdatedAt: reportedAt,
        taskId: this.state.task.value.id,
        workingContext: this.state.workingContext.value,
      }),
      workingContextEtag: this.state.workingContext.etag,
    });
    this.syncState(updated);
  }

  async enqueueFollowUpTask(request: HandsFollowUpTaskRequest): Promise<EnqueueTaskResult> {
    await this.checkpoint('before_follow_up_enqueue');
    const response = await this.options.followUpQueue.enqueueFollowUpTasks(
      handsEnqueueFollowUpRequestSchema.parse({
        agentId: this.state.task.value.agentId,
        correlation: {
          ...this.startRequest.correlation,
          handsRunId: this.state.handsRun.value.id,
          taskId: this.state.task.value.id,
        },
        followUpTasks: [request],
        handsRunId: this.state.handsRun.value.id,
        taskId: this.state.task.value.id,
        workingContextId: this.state.workingContext.value.id,
      }),
    );
    await this.reportProgress({
      artifactIds: [],
      entryKind: 'action',
      handsActionSummary: `Queued follow-up task ${response.results[0]?.taskId ?? 'unknown'}.`,
      headline: 'Queued follow-up work.',
      level: 'info',
      message: `Queued follow-up task for ${request.requestedOutcome}.`,
      waitingForUser: false,
    });
    await this.checkpoint('after_follow_up_enqueue');

    return enqueueTaskResultSchema.parse(response.results[0]);
  }

  async finalizeOutcome(outcome: HandsHandlerOutcome): Promise<HandsRunExecutionResult> {
    const finalizedAt = this.now();
    const parsedOutcome = handsHandlerOutcomeSchema.parse(outcome);
    const progressSummary = buildTerminalProgressSummary(parsedOutcome);
    const taskState =
      parsedOutcome.kind === 'waiting_for_user'
        ? 'waiting_for_user'
        : parsedOutcome.kind === 'deferred'
          ? 'deferred'
          : parsedOutcome.kind === 'failed'
            ? 'failed'
            : parsedOutcome.kind === 'cancelled'
              ? 'cancelled'
              : 'completed';
    const runState =
      parsedOutcome.kind === 'waiting_for_user'
        ? 'waiting_for_user'
        : parsedOutcome.kind === 'failed'
          ? 'failed'
          : parsedOutcome.kind === 'cancelled'
            ? 'cancelled'
            : 'completed';
    let followUpSummary: string | undefined;
    if ('followUpTasks' in parsedOutcome && parsedOutcome.followUpTasks.length > 0) {
      const response = await this.options.followUpQueue.enqueueFollowUpTasks(
        handsEnqueueFollowUpRequestSchema.parse({
          agentId: this.state.task.value.agentId,
          correlation: {
            ...this.startRequest.correlation,
            handsRunId: this.state.handsRun.value.id,
            taskId: this.state.task.value.id,
          },
          followUpTasks: parsedOutcome.followUpTasks,
          handsRunId: this.state.handsRun.value.id,
          taskId: this.state.task.value.id,
          workingContextId: this.state.workingContext.value.id,
        }),
      );
      followUpSummary = response.results.map((result) => result.taskId).join(', ');
    }

    const updatedTask = {
      ...transitionTaskState(this.state.task.value, taskState, finalizedAt),
      ...(parsedOutcome.kind === 'deferred' ? { dueAt: parsedOutcome.dueAt } : {}),
      lastProgressAt: finalizedAt,
      progressSummary,
      updatedAt: finalizedAt,
    };
    const updatedHandsRun = {
      ...transitionHandsRunState(this.state.handsRun.value, runState, finalizedAt),
      cancellationRequestedAt: updatedTask.cancellationRequestedAt,
      failureCode: parsedOutcome.kind === 'failed' ? parsedOutcome.failureCode : null,
      failureMessage: parsedOutcome.kind === 'failed' ? parsedOutcome.failureMessage : null,
      lastHeartbeatAt: finalizedAt,
      resultCode:
        parsedOutcome.kind === 'completed' || parsedOutcome.kind === 'cancelled'
          ? parsedOutcome.resultCode ?? parsedOutcome.kind
          : parsedOutcome.kind === 'deferred'
            ? parsedOutcome.resultCode ?? 'deferred'
            : null,
      updatedAt: finalizedAt,
    };
    const updated = await this.options.repositories.execution.updateHandsRunExecution({
      handsRun: updatedHandsRun,
      handsRunEtag: this.state.handsRun.etag,
      runJournal: {
        ...this.state.runJournal.value,
        closedAt: finalizedAt,
        lastEntryAt: finalizedAt,
        progressSummary,
        resultCode: updatedHandsRun.resultCode,
        status: parsedOutcome.kind === 'failed' ? 'failed' : 'closed',
        summary: parsedOutcome.summary,
        updatedAt: finalizedAt,
      },
      runJournalEntry: buildJournalEntry({
        agentId: this.state.task.value.agentId,
        correlation: this.startRequest.correlation,
        entryKind:
          parsedOutcome.kind === 'waiting_for_user'
            ? 'waiting'
            : parsedOutcome.kind === 'failed'
              ? 'failure'
              : 'completion',
        journalId: this.state.runJournal.value.id,
        level: parsedOutcome.kind === 'failed' ? 'error' : 'info',
        message: parsedOutcome.summary,
        progressSummaryPatch: progressSummary,
        recordedAt: finalizedAt,
        taskId: this.state.task.value.id,
        taskStateAfter: updatedTask.state,
        ...(followUpSummary != null && followUpSummary.trim() !== ''
          ? {
              handsActionSummary: `Created follow-up tasks: ${followUpSummary}.`,
            }
          : {}),
      }),
      runJournalEtag: this.state.runJournal.etag,
      task: updatedTask,
      taskEtag: this.state.task.etag,
      workingContext: applyHandsEventToWorkingContext({
        latestHandsStatus: parsedOutcome.summary,
        openQuestions: parsedOutcome.kind === 'waiting_for_user' ? parsedOutcome.openQuestions : [],
        ...(parsedOutcome.kind === 'completed' ||
        parsedOutcome.kind === 'failed' ||
        parsedOutcome.kind === 'cancelled'
          ? { removeTaskId: this.state.task.value.id }
          : {}),
        summaryUpdatedAt: finalizedAt,
        taskId: this.state.task.value.id,
        workingContext: this.state.workingContext.value,
      }),
      workingContextEtag: this.state.workingContext.etag,
    });
    this.syncState(updated);
    await this.closeOpenSandboxSessions(
      parsedOutcome.kind === 'cancelled' ? 'cancelled' : 'completed',
    );

    return handsRunExecutionResultSchema.parse({
      handsRunId: updatedHandsRun.id,
      resultCode: updatedHandsRun.resultCode,
      startupOutcome: 'claimed_new_run',
      summary: parsedOutcome.summary,
      taskId: updatedTask.id,
      taskState: updatedTask.state,
    });
  }

  async failUnexpected(error: unknown): Promise<HandsRunExecutionResult> {
    return this.finalizeOutcome({
      artifactIds: [],
      failureCode: 'hands_runtime_error',
      failureMessage: error instanceof Error ? error.message : 'Hands runtime failed unexpectedly.',
      followUpTasks: [],
      kind: 'failed',
      retryable: false,
      summary: 'Hands failed unexpectedly.',
    });
  }

  private createSandboxFacade(): HandsTaskSandboxClient {
    return {
      closeSession: async (input) => {
        await this.checkpoint('before_sandbox_close');
        const session = await this.options.sandbox.closeSession(
          sandboxCloseSessionRequestSchema.parse({
            ...input,
            correlation: this.state.handsRun.value.correlation,
          }),
        );
        this.openSandboxSessionIds.delete(session.id);
        await this.checkpoint('after_sandbox_close');
        return session;
      },
      createSession: async (input) => {
        await this.checkpoint('before_sandbox_create');
        const sessionId = createRuntimeIdentifier('sbx');
        const session = await this.options.sandbox.createSession(
          sandboxCreateSessionRequestSchema.parse({
            ...input,
            agentId: this.state.task.value.agentId,
            correlation: {
              ...this.startRequest.correlation,
              handsRunId: this.state.handsRun.value.id,
              sandboxSessionId: sessionId,
              taskId: this.state.task.value.id,
            },
            handsRunId: this.state.handsRun.value.id,
            taskId: this.state.task.value.id,
          }),
        );
        this.openSandboxSessionIds.add(session.id);
        await this.checkpoint('after_sandbox_create');
        return session;
      },
      executeCommand: async (input) => {
        await this.checkpoint('before_sandbox_command');
        const result = await this.options.sandbox.executeCommand(
          sandboxExecuteCommandRequestSchema.parse({
            ...input,
            correlation: {
              ...this.startRequest.correlation,
              handsRunId: this.state.handsRun.value.id,
              taskId: this.state.task.value.id,
            },
          }),
        );
        await this.checkpoint('after_sandbox_command');
        return result;
      },
      getSession: async (sessionId) => this.options.sandbox.getSession(sessionId),
    };
  }

  private async closeOpenSandboxSessions(reason: SandboxCloseSessionRequest['reason']): Promise<void> {
    for (const sessionId of [...this.openSandboxSessionIds]) {
      try {
        await this.options.sandbox.closeSession(
          sandboxCloseSessionRequestSchema.parse({
            correlation: {
              ...this.startRequest.correlation,
              handsRunId: this.state.handsRun.value.id,
              sandboxSessionId: sessionId,
              taskId: this.state.task.value.id,
            },
            reason,
            sessionId,
          }),
        );
      } catch (error) {
        this.options.logger.warn('hands_runtime.close_sandbox_session_failed', {
          message: error instanceof Error ? error.message : 'Unknown sandbox close failure.',
          sessionId,
          taskId: this.state.task.value.id,
        });
      } finally {
        this.openSandboxSessionIds.delete(sessionId);
      }
    }
  }

  private now(): string {
    return this.options.now?.() ?? new Date().toISOString();
  }

  private syncState(updated: Awaited<ReturnType<ExecutionRepository['updateHandsRunExecution']>>): void {
    this.state = {
      ...this.state,
      handsRun: updated.handsRun,
      runJournal: updated.runJournal,
      task: updated.task,
      workingContext: updated.workingContext,
    };
  }
}

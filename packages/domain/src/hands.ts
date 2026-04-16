import type {
  HandsCancellationSnapshot,
  HandsRun,
  HandsRunState,
  HandsTaskType,
  Task,
  TaskProgressSummary,
  WorkingContext,
} from '@echidna-claw/contracts';

const supportedHandsTaskTypes = ['follow_up', 'system', 'runtime_test'] as const satisfies readonly HandsTaskType[];

const allowedHandsRunTransitions: Record<HandsRunState, readonly HandsRunState[]> = {
  queued: ['running', 'cancelled'],
  running: ['waiting_for_user', 'completed', 'failed', 'cancelled'],
  waiting_for_user: [],
  completed: [],
  failed: [],
  cancelled: [],
};

function assertHandsRunTransition(current: HandsRunState, next: HandsRunState): void {
  const transitions = allowedHandsRunTransitions[current] ?? [];
  if (!transitions.includes(next)) {
    throw new Error(`Invalid hands run transition: ${current} -> ${next}`);
  }
}

export function getSupportedHandsTaskTypes(): readonly HandsTaskType[] {
  return supportedHandsTaskTypes;
}

export function isSupportedHandsTaskType(taskType: string): taskType is HandsTaskType {
  return supportedHandsTaskTypes.includes(taskType as HandsTaskType);
}

export function assertSupportedHandsTaskType(taskType: string): asserts taskType is HandsTaskType {
  if (!isSupportedHandsTaskType(taskType)) {
    throw new Error(`Unsupported Hands task type '${taskType}'.`);
  }
}

export function canTransitionHandsRunState(current: HandsRunState, next: HandsRunState): boolean {
  return (allowedHandsRunTransitions[current] ?? []).includes(next);
}

export function transitionHandsRunState(
  handsRun: HandsRun,
  nextState: HandsRunState,
  transitionedAt: string,
): HandsRun {
  assertHandsRunTransition(handsRun.state, nextState);

  return {
    ...handsRun,
    state: nextState,
    updatedAt: transitionedAt,
    cancelledAt: nextState === 'cancelled' ? transitionedAt : handsRun.cancelledAt,
    completedAt:
      nextState === 'completed' || nextState === 'failed' || nextState === 'cancelled'
        ? transitionedAt
        : handsRun.completedAt,
    releasedAt: nextState === 'waiting_for_user' ? transitionedAt : handsRun.releasedAt,
  };
}

export function buildHandsProgressSummary(input: {
  detail?: string;
  headline: string;
  percentComplete?: number;
  waitingForUser?: boolean;
}): TaskProgressSummary {
  return {
    headline: input.headline,
    ...(input.detail ? { detail: input.detail } : {}),
    ...(input.percentComplete != null ? { percentComplete: input.percentComplete } : {}),
    waitingForUser: input.waitingForUser ?? false,
    lastActor: 'hands',
  };
}

export function createHandsCancellationSnapshot(task: Task): HandsCancellationSnapshot {
  return {
    requestedAt: task.cancellationRequestedAt,
    reason: task.cancellationReason,
    taskId: task.id,
    taskState: task.state,
  };
}

export function applyHandsEventToWorkingContext(input: {
  latestHandsStatus: string;
  openQuestions?: readonly string[];
  removeTaskId?: string;
  summaryUpdatedAt: string;
  taskId: string;
  workingContext: WorkingContext;
}): WorkingContext {
  const removeTaskId = input.removeTaskId ?? null;
  const openTaskIds =
    removeTaskId == null
      ? input.workingContext.openTaskIds.includes(input.taskId)
        ? input.workingContext.openTaskIds
        : [...input.workingContext.openTaskIds, input.taskId]
      : input.workingContext.openTaskIds.filter((taskId) => taskId !== removeTaskId);

  return {
    ...input.workingContext,
    activeTaskId:
      removeTaskId != null && input.workingContext.activeTaskId === removeTaskId
        ? null
        : input.taskId,
    latestHandsStatus: input.latestHandsStatus,
    openQuestions: [...(input.openQuestions ?? [])],
    openTaskIds,
    summary:
      input.workingContext.summary.trim() === ''
        ? input.latestHandsStatus
        : input.workingContext.summary,
    summaryUpdatedAt: input.summaryUpdatedAt,
    updatedAt: input.summaryUpdatedAt,
  };
}

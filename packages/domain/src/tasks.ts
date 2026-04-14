import type {
  QueueLane,
  Task,
  TaskLaunchState,
  TaskProgressSummary,
} from '@echidna-claw/contracts';

const queueLaneRanks: Record<QueueLane, number> = {
  user_requested: 0,
  follow_up: 1,
  scheduled: 2,
  system: 3,
};

export function createDefaultTaskLaunchState(): TaskLaunchState {
  return {
    status: 'not_requested',
    requestedAt: null,
    lastAttemptAt: null,
    lastIdempotencyKey: null,
    attemptCount: 0,
  };
}

export function getQueueLaneRank(lane: QueueLane): number {
  const rank = queueLaneRanks[lane];
  if (rank === undefined) {
    throw new Error(`Unsupported queue lane '${lane}'.`);
  }

  return rank;
}

export function getDueAtSortValue(dueAt: string | null): string {
  return dueAt ?? '9999-12-31T23:59:59.999Z';
}

export function createQueuedTaskProgressSummary(input: {
  detail?: string;
  lastActor?: TaskProgressSummary['lastActor'];
  requestedOutcome: string;
}): TaskProgressSummary {
  return {
    headline: `Queued: ${input.requestedOutcome}`,
    ...(input.detail ? { detail: input.detail } : {}),
    waitingForUser: false,
    lastActor: input.lastActor ?? 'head',
  };
}

export function withTaskProgressSummary(
  task: Task,
  progressSummary: TaskProgressSummary | null,
  updatedAt: string,
): Task {
  return {
    ...task,
    progressSummary,
    lastProgressAt: progressSummary ? updatedAt : task.lastProgressAt,
    updatedAt,
  };
}

export function markTaskLaunchRequested(
  task: Task,
  requestedAt: string,
  idempotencyKey: string,
): Task {
  const nextLaunchState: TaskLaunchState = {
    ...createDefaultTaskLaunchState(),
    status: 'requested',
    requestedAt,
    lastAttemptAt: requestedAt,
    lastIdempotencyKey: idempotencyKey,
    attemptCount: task.launchState.attemptCount + 1,
    lastErrorCode: undefined,
    lastErrorMessage: undefined,
  };

  return {
    ...task,
    launchState: nextLaunchState,
    updatedAt: requestedAt,
  };
}

export function markTaskLaunchFailed(
  task: Task,
  failedAt: string,
  errorCode: string,
  errorMessage: string,
): Task {
  return {
    ...task,
    launchState: {
      ...task.launchState,
      status: 'failed',
      lastAttemptAt: failedAt,
      lastErrorCode: errorCode,
      lastErrorMessage: errorMessage,
    },
    updatedAt: failedAt,
  };
}

export function resetTaskLaunchState(task: Task, updatedAt: string): Task {
  return {
    ...task,
    launchState: createDefaultTaskLaunchState(),
    updatedAt,
  };
}

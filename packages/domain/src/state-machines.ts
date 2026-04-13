import {
  type Agent,
  type AgentProvisioningState,
  type Approval,
  type ApprovalState,
  type Channel,
  type ChannelState,
  type SoftDeleteState,
  type Task,
  type TaskState,
} from '@echidna-claw/contracts';

const allowedTaskTransitions: Record<TaskState, readonly TaskState[]> = {
  queued: ['running', 'cancelled', 'deferred'],
  running: ['waiting_for_user', 'completed', 'failed', 'cancelled', 'deferred'],
  waiting_for_user: ['queued', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
  deferred: ['queued', 'cancelled'],
};

const allowedApprovalTransitions: Record<ApprovalState, readonly ApprovalState[]> = {
  requested: ['approved', 'rejected', 'expired', 'cancelled'],
  approved: [],
  rejected: [],
  expired: [],
  cancelled: [],
};

const allowedProvisioningTransitions: Record<
  AgentProvisioningState,
  readonly AgentProvisioningState[]
> = {
  pending_provisioning: ['provisioning', 'provisioning_failed'],
  provisioning: ['active', 'provisioning_failed'],
  provisioning_failed: ['pending_provisioning', 'provisioning'],
  active: ['provisioning_failed'],
};

const allowedSoftDeleteTransitions: Record<SoftDeleteState, readonly SoftDeleteState[]> = {
  active: ['soft_deleted'],
  soft_deleted: ['active'],
};

const allowedChannelTransitions: Record<ChannelState, readonly ChannelState[]> = {
  pending_provisioning: ['provisioning', 'provisioning_failed'],
  provisioning: ['active', 'provisioning_failed'],
  provisioning_failed: ['pending_provisioning', 'provisioning'],
  active: ['provisioning_failed', 'retired'],
  retired: [],
};

function assertTransition<TState extends string>(
  current: TState,
  next: TState,
  allowedTransitions: Record<TState, readonly TState[]>,
  stateMachineName: string,
): void {
  const transitions = allowedTransitions[current] ?? [];

  if (!transitions.includes(next)) {
    throw new Error(`Invalid ${stateMachineName} transition: ${current} -> ${next}`);
  }
}

function clearsHandsSlot(state: TaskState): boolean {
  return ['waiting_for_user', 'completed', 'failed', 'cancelled', 'deferred'].includes(state);
}

export function canTransitionTaskState(current: TaskState, next: TaskState): boolean {
  return (allowedTaskTransitions[current] ?? []).includes(next);
}

export function transitionTaskState(
  task: Task,
  nextState: TaskState,
  transitionedAt: string,
): Task {
  assertTransition(task.state, nextState, allowedTaskTransitions, 'task');

  return {
    ...task,
    state: nextState,
    stateEnteredAt: transitionedAt,
    updatedAt: transitionedAt,
    currentHandsRunId: clearsHandsSlot(nextState) ? null : task.currentHandsRunId,
  };
}

export function canTransitionApprovalState(current: ApprovalState, next: ApprovalState): boolean {
  return (allowedApprovalTransitions[current] ?? []).includes(next);
}

export function transitionApprovalState(
  approval: Approval,
  nextState: ApprovalState,
  decidedAt: string | null,
  decisionReason = '',
): Approval {
  assertTransition(approval.state, nextState, allowedApprovalTransitions, 'approval');

  return {
    ...approval,
    state: nextState,
    decidedAt,
    decisionReason,
    updatedAt: decidedAt ?? approval.updatedAt,
  };
}

export function canTransitionAgentProvisioningState(
  current: AgentProvisioningState,
  next: AgentProvisioningState,
): boolean {
  return (allowedProvisioningTransitions[current] ?? []).includes(next);
}

export function transitionAgentProvisioningState(
  agent: Agent,
  nextState: AgentProvisioningState,
  transitionedAt: string,
): Agent {
  assertTransition(
    agent.provisioningState,
    nextState,
    allowedProvisioningTransitions,
    'agent provisioning',
  );

  return {
    ...agent,
    provisioningState: nextState,
    updatedAt: transitionedAt,
  };
}

export function canTransitionChannelState(current: ChannelState, next: ChannelState): boolean {
  return (allowedChannelTransitions[current] ?? []).includes(next);
}

export function transitionChannelState(
  channel: Channel,
  nextState: ChannelState,
  transitionedAt: string,
): Channel {
  assertTransition(channel.state, nextState, allowedChannelTransitions, 'channel');

  return {
    ...channel,
    state: nextState,
    updatedAt: transitionedAt,
  };
}

export function canTransitionSoftDeleteState(
  current: SoftDeleteState,
  next: SoftDeleteState,
): boolean {
  return (allowedSoftDeleteTransitions[current] ?? []).includes(next);
}

export function softDeleteAgent(agent: Agent, deletedAt: string): Agent {
  assertTransition(
    agent.lifecycleState,
    'soft_deleted',
    allowedSoftDeleteTransitions,
    'soft delete',
  );

  return {
    ...agent,
    lifecycleState: 'soft_deleted',
    restoredAt: null,
    softDeletedAt: deletedAt,
    updatedAt: deletedAt,
  };
}

export function restoreAgent(agent: Agent, restoredAt: string): Agent {
  assertTransition(agent.lifecycleState, 'active', allowedSoftDeleteTransitions, 'soft delete');

  return {
    ...agent,
    lifecycleState: 'active',
    restoredAt,
    softDeletedAt: null,
    updatedAt: restoredAt,
  };
}

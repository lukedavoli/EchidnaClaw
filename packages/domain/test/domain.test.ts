import { describe, expect, it } from 'vitest';

import {
  approvalSchema,
  channelSchema,
  headTurnSchema,
  handsRunSchema,
  scheduleSchema,
  taskSchema,
  type Agent,
  type Channel,
  type RepositoryConfig,
} from '../../contracts/src/index.js';

import {
  assertSingleActiveHandsRun,
  assertSingleActiveHeadTurn,
  calculateNextDueAt,
  canStartHandsRun,
  canStartHeadTurn,
  createAgentRegistryRecords,
  createDeterministicInboundMessageId,
  createDeterministicOutboundMessageId,
  createDeterministicAgentId,
  createDeterministicPrimaryChannelId,
  createInboundMessageIdempotencyKey,
  createTelegramChannelUpdateKey,
  createSandboxSessionIdempotencyKey,
  createScheduleOccurrenceKey,
  createTaskMergeKey,
  createTaskStartRequestIdempotencyKey,
  createTaskCreationIdempotencyKey,
  decodeTelegramCallbackData,
  encodeTelegramCallbackData,
  getQueueLaneRank,
  markTaskLaunchFailed,
  markTaskLaunchRequested,
  recordAgentProvisioningFailure,
  resetAgentProvisioningForRetry,
  restoreAgent,
  softDeleteAgent,
  transitionAgentProvisioningState,
  transitionApprovalState,
  transitionChannelState,
  transitionTaskState,
} from '../src/index.js';

const timestamp = '2026-04-12T00:00:00.000Z';

const correlation = {
  traceId: 'trc_domain',
  idempotencyKey: 'idem_domain',
  analyticsKey: 'anl_domain',
  taskId: 'tsk_domain',
  headTurnId: 'hdr_domain',
  handsRunId: 'hnd_domain',
  sandboxSessionId: 'sbx_domain',
  inboundMessageId: 'inm_domain',
  channelUpdateKey: 'upd_domain',
};

const repositoryConfig: RepositoryConfig = {
  version: '1',
  models: {
    defaultModel: 'gpt-5.4-mini',
    pricing: [
      {
        model: 'gpt-5.4-mini',
        provider: 'azure-foundry',
        effectiveAt: timestamp,
        unit: '1m_tokens',
        inputUsd: 0.2,
        outputUsd: 0.8,
      },
    ],
  },
  agents: {
    factoryProfile: {
      version: 'factory-v1',
      defaultTimeZone: 'Australia/Sydney',
      initialResponsibilitiesSummary: 'Shared operator default profile.',
    },
  },
  sandbox: {
    defaultPolicy: 'standard',
    policies: [
      {
        name: 'standard',
        description: 'Default policy.',
        allowFilesystemWriteUnder: ['/workspace'],
        allowOutboundHosts: ['api.telegram.org'],
        allowCommands: ['pnpm'],
      },
    ],
    packageAllowlists: [
      {
        name: 'default-runtime',
        packages: ['zod'],
      },
    ],
  },
  capabilities: {
    registry: [
      {
        id: 'telegram.messaging',
        name: 'Telegram direct messaging',
        description: 'Direct Telegram messaging support.',
        category: 'channel',
      },
    ],
  },
};

function createAgent(): Agent {
  return {
    id: 'agt_domain',
    recordType: 'agent',
    schemaVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    correlation,
    name: 'Scheduler Agent',
    timeZone: 'Australia/Sydney',
    headModel: 'gpt-5.4-mini',
    primaryChannelId: 'chn_domain',
    provisioningState: 'pending_provisioning',
    lifecycleState: 'active',
    softDeletedAt: null,
    restoredAt: null,
    factoryProfileVersion: 'factory-v1',
    responsibilitiesSummary: '',
  };
}

function createChannel(): Channel {
  return channelSchema.parse({
    id: 'chn_domain',
    recordType: 'channel',
    schemaVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    correlation,
    agentId: 'agt_domain',
    provider: 'telegram',
    state: 'pending_provisioning',
    provisioningRequestedAt: timestamp,
    provisioningStartedAt: null,
    boundAt: null,
    lastProvisioningFailedAt: null,
    recoveryAttemptCount: 0,
    lastRecoveryRequestedAt: null,
    lastInboundSequence: 0,
  });
}

describe('domain state machines', () => {
  it('transitions tasks and clears the active Hands slot when waiting for user input', () => {
    const task = taskSchema.parse({
      id: 'tsk_domain',
      recordType: 'task',
      schemaVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      correlation,
      agentId: 'agt_domain',
      type: 'follow_up',
      state: 'running',
      queue: {
        priority: 'normal',
      },
      requestedOutcome: 'Confirm deployment health',
      requestedBy: {
        kind: 'user',
        sourceMessageId: 'inm_domain',
      },
      dueAt: null,
      stateEnteredAt: timestamp,
      currentHandsRunId: 'hnd_domain',
      activeApprovalId: 'apr_domain',
      artifactIds: [],
      externalReferences: [],
      notes: '',
    });

    const waitingForUser = transitionTaskState(task, 'waiting_for_user', '2026-04-12T01:00:00.000Z');
    expect(waitingForUser.currentHandsRunId).toBeNull();
    expect(waitingForUser.state).toBe('waiting_for_user');

    expect(() => transitionTaskState(waitingForUser, 'running', '2026-04-12T02:00:00.000Z')).toThrow();
  });

  it('transitions approvals through a terminal decision', () => {
    const approval = approvalSchema.parse({
      id: 'apr_domain',
      recordType: 'approval',
      schemaVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      correlation,
      agentId: 'agt_domain',
      taskId: 'tsk_domain',
      state: 'requested',
      requestedAt: timestamp,
      decidedAt: null,
      blocking: true,
      summary: 'Authorize a production restart',
      decisionReason: '',
      expiresAt: null,
    });

    const approved = transitionApprovalState(
      approval,
      'approved',
      '2026-04-12T01:30:00.000Z',
      'Restart approved by operator.',
    );

    expect(approved.state).toBe('approved');
    expect(approved.decisionReason).toContain('approved');
    expect(() => transitionApprovalState(approved, 'rejected', '2026-04-12T01:31:00.000Z')).toThrow();
  });

  it('transitions provisioning and soft-delete lifecycle state', () => {
    const agent = createAgent();
    const channel = createChannel();
    const provisioning = transitionAgentProvisioningState(
      agent,
      'provisioning',
      '2026-04-12T00:15:00.000Z',
    );
    const channelProvisioning = transitionChannelState(
      channel,
      'provisioning',
      '2026-04-12T00:15:00.000Z',
    );
    const active = transitionAgentProvisioningState(
      provisioning,
      'active',
      '2026-04-12T00:20:00.000Z',
    );
    const channelActive = transitionChannelState(
      channelProvisioning,
      'active',
      '2026-04-12T00:20:00.000Z',
    );

    expect(active.provisioningState).toBe('active');
    expect(channelActive.state).toBe('active');

    const deleted = softDeleteAgent(active, '2026-04-12T02:00:00.000Z');
    expect(deleted.lifecycleState).toBe('soft_deleted');
    expect(deleted.softDeletedAt).toBe('2026-04-12T02:00:00.000Z');

    const restored = restoreAgent(deleted, '2026-04-13T02:00:00.000Z');
    expect(restored.lifecycleState).toBe('active');
    expect(restored.restoredAt).toBe('2026-04-13T02:00:00.000Z');
    expect(restored.softDeletedAt).toBeNull();
  });
});

describe('domain invariants and helpers', () => {
  it('enforces one active Head turn and one active Hands run per agent', () => {
    const headTurns = [
      headTurnSchema.parse({
        id: 'hdr_domain',
        recordType: 'head_turn',
        schemaVersion: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      correlation,
      agentId: 'agt_domain',
      workingContextId: 'ctx_domain',
      state: 'running',
      triggerKind: 'trusted_messages',
      inboundMessageIds: ['inm_domain'],
      readThroughMessageSequence: 1,
      taskId: null,
      scheduleId: null,
      dueAt: null,
      startedAt: timestamp,
      completedAt: null,
      supersededBySequence: null,
      providerConversationId: null,
      providerRunId: null,
      promptProfileVersion: 'head-base-v1',
      completionKind: null,
      responseMessageId: null,
    }),
    ];

    const handsRuns = [
      handsRunSchema.parse({
        id: 'hnd_domain',
        recordType: 'hands_run',
        schemaVersion: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        correlation,
        agentId: 'agt_domain',
        taskId: 'tsk_domain',
        taskEnvelopeId: 'env_domain',
        state: 'running',
        startedAt: timestamp,
        completedAt: null,
        releasedAt: null,
      }),
    ];

    expect(canStartHeadTurn(headTurns, 'agt_domain')).toBe(false);
    expect(canStartHandsRun(handsRuns, 'agt_domain')).toBe(false);

    expect(() =>
      assertSingleActiveHeadTurn(
        headTurns.concat({ ...headTurns[0], id: 'hdr_domain-2', correlation: { ...correlation, headTurnId: 'hdr_domain-2' } }),
        'agt_domain',
      ),
    ).toThrow();
    expect(() =>
      assertSingleActiveHandsRun(
        handsRuns.concat({ ...handsRuns[0], id: 'hnd_domain-2', correlation: { ...correlation, handsRunId: 'hnd_domain-2' } }),
        'agt_domain',
      ),
    ).toThrow();
  });

  it('calculates deterministic future schedule occurrences', () => {
    const schedule = scheduleSchema.parse({
      id: 'sch_domain',
      recordType: 'schedule',
      schemaVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      correlation,
      agentId: 'agt_domain',
      state: 'active',
      description: 'Daily stand-up reminder',
      naturalLanguageRequest: 'Remind me every day at 9am Sydney time.',
      recurrence: {
        frequency: 'daily',
        interval: 1,
        timeZone: 'Australia/Sydney',
        anchorAt: timestamp,
        localTime: '09:00',
      },
      nextDueAt: null,
      lastMaterializedOccurrenceAt: null,
      skipMissedOccurrencesOnRestore: true,
    });

    expect(calculateNextDueAt(schedule, timestamp)).toBe('2026-04-13T00:00:00.000Z');
    expect(calculateNextDueAt({ ...schedule, state: 'paused' }, timestamp)).toBeNull();
  });

  it('builds deterministic idempotency keys', () => {
    expect(createInboundMessageIdempotencyKey('agt_domain', 'tg-123')).toContain('idem_');
    expect(createTaskCreationIdempotencyKey('agt_domain', 'Check deployment', null)).toContain('idem_');
    expect(
      createTaskMergeKey({
        agentId: 'agt_domain',
        requestedOutcome: 'Check deployment',
        requestedByKind: 'user',
        taskType: 'follow_up',
      }),
    ).toContain('merge_');
    expect(createTaskStartRequestIdempotencyKey('tsk_domain', 'env_domain', 2)).toContain('idem_');
    expect(createSandboxSessionIdempotencyKey('hnd_domain', 'standard')).toContain('idem_');
    expect(createScheduleOccurrenceKey('sch_domain', timestamp)).toContain('occ_');
  });

  it('orders queue lanes and tracks launch retries for deferred work', () => {
    expect(getQueueLaneRank('user_requested')).toBeLessThan(getQueueLaneRank('scheduled'));

    const deferredTask = taskSchema.parse({
      id: 'tsk_launch-domain',
      recordType: 'task',
      schemaVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      correlation,
      agentId: 'agt_domain',
      type: 'follow_up',
      state: 'deferred',
      queue: {
        lane: 'follow_up',
        priority: 'normal',
      },
      requestedOutcome: 'Resume the deferred deployment check',
      requestedBy: {
        kind: 'system',
      },
      dueAt: null,
      stateEnteredAt: timestamp,
      scheduleId: undefined,
      activeTaskEnvelopeId: 'env_domain',
      currentRunJournalId: 'rjn_domain',
      currentHandsRunId: null,
      activeApprovalId: null,
      mergeKey: 'merge_domain',
      mergedIntoTaskId: null,
      attemptCount: 2,
      launchState: {
        status: 'failed',
        requestedAt: '2026-04-12T00:10:00.000Z',
        lastAttemptAt: '2026-04-12T00:10:00.000Z',
        lastIdempotencyKey: 'idem_launch-domain',
        attemptCount: 1,
        lastErrorCode: 'hands_start_request_failed',
        lastErrorMessage: 'Previous start request failed.',
      },
      progressSummary: null,
      lastProgressAt: null,
      completedAt: null,
      failedAt: null,
      cancelledAt: null,
      artifactIds: [],
      externalReferences: [],
      notes: '',
    });

    const requeued = transitionTaskState(deferredTask, 'queued', '2026-04-12T00:20:00.000Z');
    const requested = markTaskLaunchRequested(
      requeued,
      '2026-04-12T00:21:00.000Z',
      'idem_launch-retry',
    );
    const failed = markTaskLaunchFailed(
      requested,
      '2026-04-12T00:21:30.000Z',
      'hands_start_request_failed',
      'Hands startup is still unavailable.',
    );

    expect(requeued.state).toBe('queued');
    expect(requested.launchState.status).toBe('requested');
    expect(requested.launchState.attemptCount).toBe(2);
    expect(failed.launchState.status).toBe('failed');
    expect(failed.launchState.lastErrorCode).toBe('hands_start_request_failed');
  });

  it('builds deterministic Telegram message identifiers and callback payloads', () => {
    expect(createDeterministicInboundMessageId('agt_domain', 'tg-123')).toContain('inm_');
    expect(createDeterministicOutboundMessageId('agt_domain', 'idem_dispatch-1')).toContain('out_');
    expect(createTelegramChannelUpdateKey('agt_domain', 'tg-123')).toContain('upd_');

    const encoded = encodeTelegramCallbackData({
      approvalId: 'apr_domain',
      decision: 'approve',
      kind: 'approval_decision',
      label: 'Approve',
    });
    expect(encoded).toBe('ec1|a|apr_domain|y');
    expect(decodeTelegramCallbackData(encoded)).toEqual({
      approvalId: 'apr_domain',
      decision: 'approve',
      kind: 'approval_decision',
    });
    expect(decodeTelegramCallbackData('ec1|a|bad|y')).toBeNull();
  });

  it('creates deterministic registry records and resets failed provisioning for retry', () => {
    const created = createAgentRegistryRecords({
      correlation: {
        ...correlation,
        idempotencyKey: 'idem_domain-agent-create',
      },
      createdAt: timestamp,
      name: 'Registry Agent',
      repositoryConfig,
    });

    expect(created.agent.id).toBe(createDeterministicAgentId('idem_domain-agent-create'));
    expect(created.agent.primaryChannelId).toBe(createDeterministicPrimaryChannelId(created.agent.id));
    expect(created.primaryChannel.id).toBe(created.agent.primaryChannelId);
    expect(created.primaryChannel.state).toBe('pending_provisioning');

    const failed = recordAgentProvisioningFailure({
      agent: {
        ...created.agent,
        provisioningState: 'provisioning',
      },
      primaryChannel: {
        ...created.primaryChannel,
        state: 'provisioning',
        provisioningStartedAt: '2026-04-12T00:05:00.000Z',
      },
      failedAt: '2026-04-12T00:06:00.000Z',
      errorCode: 'telegram_bind_failed',
      errorMessage: 'Telegram binding failed.',
    });

    expect(failed.agent.provisioningState).toBe('provisioning_failed');
    expect(failed.primaryChannel.state).toBe('provisioning_failed');
    expect(failed.primaryChannel.lastProvisioningErrorCode).toBe('telegram_bind_failed');

    const retried = resetAgentProvisioningForRetry({
      agent: failed.agent,
      primaryChannel: failed.primaryChannel,
      requestedAt: '2026-04-12T00:10:00.000Z',
    });

    expect(retried.agent.provisioningState).toBe('pending_provisioning');
    expect(retried.primaryChannel.state).toBe('pending_provisioning');
    expect(retried.primaryChannel.recoveryAttemptCount).toBe(1);
    expect(retried.primaryChannel.lastRecoveryRequestedAt).toBe('2026-04-12T00:10:00.000Z');
  });
});

describe('domain smoke flow', () => {
  it('keeps the core execution chain correlated from inbound message to approval completion', () => {
    const runningTask = taskSchema.parse({
      id: 'tsk_domain',
      recordType: 'task',
      schemaVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      correlation,
      agentId: 'agt_domain',
      type: 'approval_gated',
      state: 'running',
      queue: {
        priority: 'high',
      },
      requestedOutcome: 'Restart the production worker',
      requestedBy: {
        kind: 'user',
        sourceMessageId: 'inm_domain',
      },
      dueAt: null,
      stateEnteredAt: timestamp,
      currentHandsRunId: 'hnd_domain',
      activeApprovalId: 'apr_domain',
      artifactIds: [],
      externalReferences: [],
      notes: '',
    });

    const approval = approvalSchema.parse({
      id: 'apr_domain',
      recordType: 'approval',
      schemaVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      correlation,
      agentId: 'agt_domain',
      taskId: 'tsk_domain',
      state: 'requested',
      requestedAt: timestamp,
      decidedAt: null,
      blocking: true,
      summary: 'Approve a production worker restart',
      decisionReason: '',
      expiresAt: null,
    });

    const waiting = transitionTaskState(runningTask, 'waiting_for_user', '2026-04-12T00:10:00.000Z');
    const approved = transitionApprovalState(
      approval,
      'approved',
      '2026-04-12T00:11:00.000Z',
      'Approved from Telegram direct message.',
    );
    const requeued = transitionTaskState(
      { ...waiting, currentHandsRunId: null },
      'queued',
      '2026-04-12T00:11:05.000Z',
    );
    const completed = transitionTaskState(
      { ...requeued, state: 'running', currentHandsRunId: 'hnd_domain' },
      'completed',
      '2026-04-12T00:20:00.000Z',
    );

    expect(waiting.currentHandsRunId).toBeNull();
    expect(approved.state).toBe('approved');
    expect(completed.state).toBe('completed');
    expect(completed.correlation.taskId).toBe('tsk_domain');
    expect(approved.correlation.taskId).toBe(completed.id);
  });
});

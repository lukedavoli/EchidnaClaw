import { describe, expect, it } from 'vitest';

import {
  approvalSchema,
  headTurnSchema,
  handsRunSchema,
  scheduleSchema,
  taskSchema,
  type Agent,
} from '../../contracts/src/index.js';

import {
  assertSingleActiveHandsRun,
  assertSingleActiveHeadTurn,
  calculateNextDueAt,
  canStartHandsRun,
  canStartHeadTurn,
  createInboundMessageIdempotencyKey,
  createSandboxSessionIdempotencyKey,
  createScheduleOccurrenceKey,
  createTaskCreationIdempotencyKey,
  restoreAgent,
  softDeleteAgent,
  transitionAgentProvisioningState,
  transitionApprovalState,
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
    provisioningState: 'pending_provisioning',
    lifecycleState: 'active',
    softDeletedAt: null,
    restoredAt: null,
    factoryProfileVersion: 'factory-v1',
    responsibilitiesSummary: '',
  };
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
    const provisioning = transitionAgentProvisioningState(
      agent,
      'provisioning',
      '2026-04-12T00:15:00.000Z',
    );
    const active = transitionAgentProvisioningState(
      provisioning,
      'active',
      '2026-04-12T00:20:00.000Z',
    );

    expect(active.provisioningState).toBe('active');

    const deleted = softDeleteAgent(active, '2026-04-12T02:00:00.000Z');
    expect(deleted.lifecycleState).toBe('soft_deleted');
    expect(deleted.softDeletedAt).toBe('2026-04-12T02:00:00.000Z');

    const restored = restoreAgent(deleted, '2026-04-13T02:00:00.000Z');
    expect(restored.lifecycleState).toBe('active');
    expect(restored.restoredAt).toBe('2026-04-13T02:00:00.000Z');
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
        state: 'running',
        inboundMessageIds: ['inm_domain'],
        readThroughMessageSequence: 1,
        startedAt: timestamp,
        completedAt: null,
        supersededBySequence: null,
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
    expect(createSandboxSessionIdempotencyKey('hnd_domain', 'standard')).toContain('idem_');
    expect(createScheduleOccurrenceKey('sch_domain', timestamp)).toContain('occ_');
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

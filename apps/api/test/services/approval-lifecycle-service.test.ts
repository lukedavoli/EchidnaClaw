import { createRuntimeTestHarness, seedActiveTelegramAgentState } from '@echidna-claw/testing';
import {
  createRunJournal,
  createTask,
  createCorrelationMetadata,
  createOutboundMessage,
} from '@echidna-claw/persistence';
import { describe, expect, it } from 'vitest';

import { createAuditHistoryService } from '../../src/services/runtime/audit-history-service.js';
import { createApprovalLifecycleService } from '../../src/services/runtime/approval-lifecycle-service.js';

async function createApprovalHarness() {
  const harness = createRuntimeTestHarness({
    serviceName: 'approval-lifecycle-test',
  });
  const logger = harness.loggerFactory.createLogger({ service: 'approval_lifecycle_test' });
  const seeded = await seedActiveTelegramAgentState({
    channel: {
      id: 'chn_approval',
    },
    suite: harness.suite,
    workingContext: {
      id: 'ctx_approval',
      pendingApprovalIds: [],
    },
  });
  const correlation = createCorrelationMetadata({
    idempotencyKey: 'idem_approval-task',
    taskId: 'tsk_approval',
    traceId: 'trc_approval-task',
  });
  const task = await harness.suite.tasks.createTask(
    createTask({
      agentId: seeded.agent.value.id,
      correlation,
      currentHandsRunId: 'hnd_approval',
      currentRunJournalId: 'rjn_approval',
      id: 'tsk_approval',
      requestedOutcome: 'Approve the deployment restart.',
      state: 'running',
    }),
  );
  const runJournal = await harness.suite.runJournals.openJournal(
    createRunJournal({
      agentId: seeded.agent.value.id,
      correlation,
      handsRunId: 'hnd_approval',
      id: 'rjn_approval',
      scope: 'hands_run',
      scopeId: 'hnd_approval',
      summary: 'Running approval-sensitive task.',
      taskId: task.value.id,
    }),
  );
  const sentMessages: string[] = [];
  const releasedRuns: string[] = [];
  const restartedTasks: string[] = [];
  const auditHistoryService = createAuditHistoryService({
    logger,
    repositories: harness.suite,
    repositoryConfig: harness.repositoryConfig,
  });
  const service = createApprovalLifecycleService({
    auditHistoryService,
    handsRuntimeService: {
      async releaseForUser(input) {
        releasedRuns.push(input.handsRunId);
      },
      async startRun() {
        throw new Error('unused');
      },
    },
    logger,
    outboundMessagingService: {
      async sendMessage(input) {
        sentMessages.push(input.text);
        return createOutboundMessage({
          agentId: input.agentId,
          body: {
            artifacts: [],
            text: input.text,
          },
          channelId: input.channelId,
          correlation: input.correlation,
        });
      },
    },
    repositories: harness.suite,
    repositoryConfig: harness.repositoryConfig,
    taskQueueService: {
      async activateDeferredTask() {
        throw new Error('unused');
      },
      async enqueueTask() {
        throw new Error('unused');
      },
      async getTaskStatusSnapshot() {
        throw new Error('unused');
      },
      async requestQueuedTaskStart(input) {
        restartedTasks.push(input.taskId);
        return {
          adapterAccepted: true,
          attempted: true,
          errorCode: null,
          errorMessage: null,
          replayed: false,
          taskEnvelopeId: 'env_persistence',
          taskId: input.taskId,
        };
      },
    },
  });

  return {
    auditHistoryService,
    correlation,
    harness,
    releasedRuns,
    restartedTasks,
    runJournal,
    seeded,
    sentMessages,
    service,
    task,
  };
}

describe('approval lifecycle service', () => {
  it('coalesces duplicate approval requests for the same task', async () => {
    const harness = await createApprovalHarness();

    const first = await harness.service.requestApproval({
      agentId: harness.seeded.agent.value.id,
      category: 'other',
      channelId: harness.seeded.channel.value.id,
      correlation: harness.correlation,
      summary: 'Approve the deployment restart.',
      taskId: harness.task.value.id,
    });
    const second = await harness.service.requestApproval({
      agentId: harness.seeded.agent.value.id,
      category: 'other',
      channelId: harness.seeded.channel.value.id,
      correlation: {
        ...harness.correlation,
        idempotencyKey: 'idem_approval-task-duplicate',
      },
      summary: 'Approve the deployment restart.',
      taskId: harness.task.value.id,
    });

    expect(second.id).toBe(first.id);
    expect(harness.releasedRuns).toEqual(['hnd_approval']);
    expect(harness.sentMessages).toHaveLength(1);

    const storedTask = await harness.harness.suite.tasks.getTask(
      harness.seeded.agent.value.id,
      harness.task.value.id,
    );
    expect(storedTask?.value.state).toBe('waiting_for_user');
    expect(storedTask?.value.activeApprovalId).toBe(first.id);
  });

  it('approves once, restarts queued work, and replays duplicate decisions safely', async () => {
    const harness = await createApprovalHarness();
    const approval = await harness.service.requestApproval({
      agentId: harness.seeded.agent.value.id,
      category: 'other',
      channelId: harness.seeded.channel.value.id,
      correlation: harness.correlation,
      summary: 'Approve the deployment restart.',
      taskId: harness.task.value.id,
    });

    const approved = await harness.service.recordDecision({
      approvalId: approval.id,
      channelId: harness.seeded.channel.value.id,
      correlation: {
        ...harness.correlation,
        idempotencyKey: 'idem_approval-approve',
      },
      decision: 'approve',
      inboundMessageId: 'inm_approval-approve',
      kind: 'approval_decision',
      label: 'Approve',
    });
    const replay = await harness.service.recordDecision({
      approvalId: approval.id,
      channelId: harness.seeded.channel.value.id,
      correlation: {
        ...harness.correlation,
        idempotencyKey: 'idem_approval-approve-replay',
      },
      decision: 'approve',
      inboundMessageId: 'inm_approval-approve-replay',
      kind: 'approval_decision',
      label: 'Approve',
    });

    expect(approved.state).toBe('approved');
    expect(replay.state).toBe('approved');
    expect(harness.restartedTasks).toEqual(['tsk_approval']);

    const storedTask = await harness.harness.suite.tasks.getTask(
      harness.seeded.agent.value.id,
      harness.task.value.id,
    );
    expect(storedTask?.value.state).toBe('queued');
    expect(storedTask?.value.activeApprovalId).toBeNull();
  });

  it('rejects approval requests into cancelled tasks', async () => {
    const harness = await createApprovalHarness();
    const approval = await harness.service.requestApproval({
      agentId: harness.seeded.agent.value.id,
      category: 'other',
      channelId: harness.seeded.channel.value.id,
      correlation: harness.correlation,
      summary: 'Approve the deployment restart.',
      taskId: harness.task.value.id,
    });

    const rejected = await harness.service.recordDecision({
      approvalId: approval.id,
      channelId: harness.seeded.channel.value.id,
      correlation: {
        ...harness.correlation,
        idempotencyKey: 'idem_approval-reject',
      },
      decision: 'reject',
      inboundMessageId: 'inm_approval-reject',
      kind: 'approval_decision',
      label: 'Reject',
    });

    expect(rejected.state).toBe('rejected');
    expect(harness.restartedTasks).toHaveLength(0);

    const storedTask = await harness.harness.suite.tasks.getTask(
      harness.seeded.agent.value.id,
      harness.task.value.id,
    );
    expect(storedTask?.value.state).toBe('cancelled');
    expect(storedTask?.value.cancellationReason).toContain('Rejected');
  });

  it('expires late approval decisions instead of resuming work', async () => {
    const harness = await createApprovalHarness();
    const approval = await harness.service.requestApproval({
      agentId: harness.seeded.agent.value.id,
      category: 'other',
      channelId: harness.seeded.channel.value.id,
      correlation: harness.correlation,
      expiresAt: '2026-04-11T23:59:00.000Z',
      summary: 'Approve the deployment restart.',
      taskId: harness.task.value.id,
    });

    const expired = await harness.service.recordDecision({
      approvalId: approval.id,
      channelId: harness.seeded.channel.value.id,
      correlation: {
        ...harness.correlation,
        idempotencyKey: 'idem_approval-expired',
      },
      decision: 'approve',
      inboundMessageId: 'inm_approval-expired',
      kind: 'approval_decision',
      label: 'Approve',
    });

    expect(expired.state).toBe('expired');
    expect(harness.restartedTasks).toHaveLength(0);

    const storedTask = await harness.harness.suite.tasks.getTask(
      harness.seeded.agent.value.id,
      harness.task.value.id,
    );
    expect(storedTask?.value.state).toBe('cancelled');
  });
});

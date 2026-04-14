import {
  createAgentRegistryRecords,
  recordAgentProvisioningFailure,
  resetAgentProvisioningForRetry,
  transitionTaskState,
} from '@echidna-claw/domain';
import { describe, expect, it } from 'vitest';

import {
  AesGcmCredentialEnvelopeCipher,
  DuplicateRecordError,
  FakeClock,
  InMemoryArtifactContentStore,
  InMemoryRecordStore,
  OptimisticConcurrencyError,
  StaticKeyEncryptionKey,
  createAgent,
  createApproval,
  createArtifact,
  createChannel,
  createCorrelationMetadata,
  createCredentialRef,
  createHandsRun,
  createIdempotencyRecord,
  createInboundMessage,
  createOutboundMessage,
  createRepositorySuite,
  createRunJournal,
  createRunJournalEntry,
  createSandboxSession,
  createSchedule,
  createTask,
  createTaskEnvelope,
  createUsageEvent,
  createWorkingContext,
} from '../src/index.js';

const repositoryConfig = {
  version: '1' as const,
  models: {
    defaultModel: 'gpt-5.4-mini' as const,
    pricing: [
      {
        model: 'gpt-5.4-mini' as const,
        provider: 'azure-foundry' as const,
        effectiveAt: '2026-04-12T00:00:00.000Z',
        unit: '1m_tokens' as const,
        inputUsd: 0.2,
        outputUsd: 0.8,
      },
    ],
  },
  agents: {
    factoryProfile: {
      version: 'factory-v1',
      defaultTimeZone: 'Australia/Sydney',
      initialResponsibilitiesSummary: 'Shared operator profile.',
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
        category: 'channel' as const,
      },
    ],
  },
};

function createTestSuite() {
  const clock = new FakeClock(new Date('2026-04-12T00:00:00.000Z'));
  const recordStore = new InMemoryRecordStore();
  const artifactContentStore = new InMemoryArtifactContentStore();
  const credentialEnvelopeCipher = new AesGcmCredentialEnvelopeCipher(
    new StaticKeyEncryptionKey('local://suite-key', new Uint8Array([5, 11, 17, 23, 31])),
  );

  return {
    artifactContentStore,
    clock,
    repositories: createRepositorySuite({
      recordStore,
      artifactContentStore,
      credentialEnvelopeCipher,
      clock,
    }),
  };
}

describe('repository suite contracts', () => {
  it('enforces optimistic concurrency for mutable records', async () => {
    const { repositories } = createTestSuite();
    const agent = createAgent();

    const created = await repositories.agents.create(agent);

    const updated = await repositories.agents.replace(
      {
        ...created.value,
        updatedAt: '2026-04-12T00:10:00.000Z',
        responsibilitiesSummary: 'Updated after provisioning.',
      },
      created.etag,
    );

    expect(updated.value.responsibilitiesSummary).toContain('Updated');

    await expect(
      repositories.agents.replace(
        {
          ...updated.value,
          updatedAt: '2026-04-12T00:11:00.000Z',
        },
        created.etag,
      ),
    ).rejects.toBeInstanceOf(OptimisticConcurrencyError);
  });

  it('creates and updates agent-registry entries atomically', async () => {
    const { repositories } = createTestSuite();
    const createdRecords = createAgentRegistryRecords({
      correlation: createCorrelationMetadata({
        idempotencyKey: 'idem_registry-create',
        traceId: 'trc_registry-create',
      }),
      createdAt: '2026-04-12T00:00:00.000Z',
      name: 'Registry Agent',
      repositoryConfig,
    });

    const createdEntry = await repositories.agentRegistry.createRegistryEntry(createdRecords);
    expect(createdEntry.primaryChannel?.value.id).toBe(createdEntry.agent.value.primaryChannelId);

    const failed = recordAgentProvisioningFailure({
      agent: {
        ...createdEntry.agent.value,
        provisioningState: 'provisioning',
      },
      primaryChannel: {
        ...createdEntry.primaryChannel!.value,
        provisioningStartedAt: '2026-04-12T00:05:00.000Z',
        state: 'provisioning',
      },
      failedAt: '2026-04-12T00:06:00.000Z',
      errorCode: 'telegram_bind_failed',
      errorMessage: 'Telegram binding failed.',
    });

    const failedEntry = await repositories.agentRegistry.recordProvisioningFailure({
      agent: failed.agent,
      agentEtag: createdEntry.agent.etag,
      primaryChannel: failed.primaryChannel,
      primaryChannelEtag: createdEntry.primaryChannel!.etag,
    });

    expect(failedEntry.agent.value.provisioningState).toBe('provisioning_failed');
    expect(failedEntry.primaryChannel?.value.lastProvisioningErrorCode).toBe('telegram_bind_failed');

    const retried = resetAgentProvisioningForRetry({
      agent: failedEntry.agent.value,
      primaryChannel: failedEntry.primaryChannel!.value,
      requestedAt: '2026-04-12T00:10:00.000Z',
    });

    const retriedEntry = await repositories.agentRegistry.retryProvisioning({
      agent: retried.agent,
      agentEtag: failedEntry.agent.etag,
      primaryChannel: retried.primaryChannel,
      primaryChannelEtag: failedEntry.primaryChannel!.etag,
    });

    expect(retriedEntry.agent.value.provisioningState).toBe('pending_provisioning');
    expect(retriedEntry.primaryChannel?.value.recoveryAttemptCount).toBe(1);
  });

  it('atomically appends inbound messages and replays duplicates through idempotency records', async () => {
    const { repositories } = createTestSuite();
    await repositories.agents.create(createAgent());
    const createdChannel = await repositories.channels.create(createChannel());
    const message = createInboundMessage();
    const idempotencyRecord = createIdempotencyRecord({
      resultReference: message.id,
    });

    const appended = await repositories.messages.appendInboundMessage({
      channel: {
        ...createdChannel.value,
        lastInboundSequence: message.sequence,
        lastInboundExternalMessageId: message.externalMessageId,
        lastExternalMessageId: message.externalMessageId,
        lastInboundReceivedAt: message.receivedAt,
        updatedAt: message.receivedAt,
      },
      channelEtag: createdChannel.etag,
      idempotencyRecord,
      message,
    });

    expect(appended.replayed).toBe(false);
    expect(appended.channel.value.lastInboundSequence).toBe(1);
    expect(appended.channel.value.lastInboundExternalMessageId).toBe(message.externalMessageId);

    const replayed = await repositories.messages.appendInboundMessage({
      channel: {
        ...appended.channel.value,
        updatedAt: '2026-04-12T00:00:01.000Z',
      },
      channelEtag: appended.channel.etag,
      idempotencyRecord,
      message,
    });

    expect(replayed.replayed).toBe(true);
    expect(replayed.message.value.id).toBe(message.id);
    expect(replayed.idempotencyRecord.value.resultReference).toBe(message.id);
  });

  it('updates outbound delivery state and channel bookkeeping atomically', async () => {
    const { repositories } = createTestSuite();
    await repositories.agents.create(createAgent());
    const createdChannel = await repositories.channels.create(createChannel());
    const createdOutbound = await repositories.messages.createOutboundMessage(createOutboundMessage());

    const saved = await repositories.messages.saveOutboundDelivery({
      channel: {
        ...createdChannel.value,
        lastOutboundExternalMessageId: 'telegram-outbound-1',
        lastOutboundSentAt: '2026-04-12T00:05:00.000Z',
        updatedAt: '2026-04-12T00:05:00.000Z',
      },
      channelEtag: createdChannel.etag,
      message: {
        ...createdOutbound.value,
        deliveryState: 'sent',
        externalMessageId: 'telegram-outbound-1',
        sentAt: '2026-04-12T00:05:00.000Z',
        updatedAt: '2026-04-12T00:05:00.000Z',
      },
      messageEtag: createdOutbound.etag,
    });

    expect(saved.message.value.deliveryState).toBe('sent');
    expect(saved.message.value.externalMessageId).toBe('telegram-outbound-1');
    expect(saved.channel?.value.lastOutboundExternalMessageId).toBe('telegram-outbound-1');
    expect(saved.channel?.value.lastOutboundSentAt).toBe('2026-04-12T00:05:00.000Z');
  });

  it('creates approvals and related task transitions atomically', async () => {
    const { repositories } = createTestSuite();
    await repositories.agents.create(createAgent());
    const createdTask = await repositories.tasks.createTask(
      createTask({
        state: 'running',
        currentHandsRunId: 'hnd_persistence',
        activeApprovalId: 'apr_persistence',
      }),
    );

    const waitingTask = transitionTaskState(
      createdTask.value,
      'waiting_for_user',
      '2026-04-12T00:05:00.000Z',
    );
    const approval = createApproval({
      requestedAt: '2026-04-12T00:05:00.000Z',
    });

    const createdApproval = await repositories.approvals.createForTask({
      approval,
      task: {
        ...waitingTask,
        activeApprovalId: approval.id,
      },
      taskEtag: createdTask.etag,
    });

    expect(createdApproval.task.value.state).toBe('waiting_for_user');
    expect(createdApproval.approval.value.taskId).toBe(createdTask.value.id);
  });

  it('orders queued tasks and due schedules deterministically', async () => {
    const { repositories } = createTestSuite();
    await repositories.agents.create(createAgent());

    await repositories.tasks.createTask(
      createTask({
        id: 'tsk_high',
        queue: { lane: 'scheduled', priority: 'high' },
        dueAt: '2026-04-12T02:00:00.000Z',
        createdAt: '2026-04-12T00:00:01.000Z',
        updatedAt: '2026-04-12T00:00:01.000Z',
      }),
    );
    await repositories.tasks.createTask(
      createTask({
        id: 'tsk_urgent',
        queue: { lane: 'user_requested', priority: 'urgent' },
        dueAt: '2026-04-12T03:00:00.000Z',
        createdAt: '2026-04-12T00:00:02.000Z',
        updatedAt: '2026-04-12T00:00:02.000Z',
      }),
    );
    await repositories.tasks.createTask(
      createTask({
        id: 'tsk_user-normal',
        queue: { lane: 'user_requested', priority: 'normal' },
        dueAt: null,
        createdAt: '2026-04-12T00:00:03.000Z',
        updatedAt: '2026-04-12T00:00:03.000Z',
      }),
    );

    const queuedTasks = await repositories.tasks.listQueuedTasks('agt_persistence');
    expect(queuedTasks.map((task) => task.value.id)).toEqual([
      'tsk_urgent',
      'tsk_user-normal',
      'tsk_high',
    ]);

    const queuedForDispatch = await repositories.tasks.listQueuedTasksForDispatch(
      'agt_persistence',
    );
    expect(queuedForDispatch.map((task) => task.value.id)).toEqual([
      'tsk_urgent',
      'tsk_user-normal',
      'tsk_high',
    ]);

    await repositories.schedules.create(
      createSchedule({
        id: 'sch_earlier',
        nextDueAt: '2026-04-12T00:30:00.000Z',
      }),
    );
    await repositories.schedules.create(
      createSchedule({
        id: 'sch_later',
        nextDueAt: '2026-04-12T01:30:00.000Z',
      }),
    );

    const dueSchedules = await repositories.schedules.listDueSchedules(
      '2026-04-12T02:00:00.000Z',
    );
    expect(dueSchedules.map((schedule) => schedule.value.id)).toEqual([
      'sch_earlier',
      'sch_later',
    ]);
  });

  it('creates and merges queued task graphs atomically with journal state', async () => {
    const { repositories } = createTestSuite();
    await repositories.agents.create(createAgent());
    const createdWorkingContext = await repositories.workingContexts.create(
      createWorkingContext({ openTaskIds: [] }),
    );

    const created = await repositories.tasks.createTaskWithEnvelope({
      idempotencyRecord: createIdempotencyRecord({
        id: 'idr_enqueue-graph',
        key: 'enqueue-graph-1',
        scope: 'head:create-task',
        resultReference: 'tsk_graph',
      }),
      runJournal: createRunJournal({
        id: 'rjn_graph',
        handsRunId: null,
        scope: 'head_turn',
        scopeId: 'hdr_graph',
        taskId: 'tsk_graph',
      }),
      runJournalEntry: createRunJournalEntry({
        id: 'rje_graph',
        journalId: 'rjn_graph',
        message: 'Queued graph task.',
      }),
      task: createTask({
        id: 'tsk_graph',
        activeTaskEnvelopeId: 'env_graph',
        currentRunJournalId: 'rjn_graph',
      }),
      taskEnvelope: createTaskEnvelope({
        id: 'env_graph',
        taskId: 'tsk_graph',
      }),
      workingContext: {
        ...createdWorkingContext.value,
        activeTaskId: 'tsk_graph',
        openTaskIds: ['tsk_graph'],
        updatedAt: '2026-04-12T00:05:00.000Z',
      },
      workingContextEtag: createdWorkingContext.etag,
    });

    expect(created.task.value.id).toBe('tsk_graph');
    expect(created.taskEnvelope?.value.taskId).toBe('tsk_graph');
    expect(created.runJournal.value.taskId).toBe('tsk_graph');
    expect(created.workingContext.value.openTaskIds).toEqual(['tsk_graph']);

    const mergedTask = {
      ...created.task.value,
      notes: 'Merged note.',
      updatedAt: '2026-04-12T00:06:00.000Z',
    };
    const mergedJournal = {
      ...created.runJournal.value,
      summary: 'Merged graph task.',
      lastEntryAt: '2026-04-12T00:06:00.000Z',
      updatedAt: '2026-04-12T00:06:00.000Z',
    };
    const merged = await repositories.tasks.mergeTaskIntoQueue({
      runJournal: mergedJournal,
      runJournalEtag: created.runJournal.etag,
      runJournalEntry: createRunJournalEntry({
        id: 'rje_graph-merge',
        journalId: created.runJournal.value.id,
        entryKind: 'action',
        message: 'Merged duplicate task request.',
      }),
      task: mergedTask,
      taskEtag: created.task.etag,
      workingContext: {
        ...created.workingContext.value,
        updatedAt: '2026-04-12T00:06:00.000Z',
      },
      workingContextEtag: created.workingContext.etag,
    });

    expect(merged.task.value.notes).toBe('Merged note.');
    expect(merged.runJournal.value.summary).toBe('Merged graph task.');
  });

  it('records launch requests and journal summary updates atomically', async () => {
    const { repositories } = createTestSuite();
    await repositories.agents.create(createAgent());
    const createdWorkingContext = await repositories.workingContexts.create(
      createWorkingContext({ openTaskIds: [] }),
    );
    const created = await repositories.tasks.createTaskWithEnvelope({
      runJournal: createRunJournal({
        id: 'rjn_launch',
        handsRunId: null,
        scope: 'head_turn',
        scopeId: 'hdr_launch',
        taskId: 'tsk_launch',
      }),
      runJournalEntry: createRunJournalEntry({
        id: 'rje_launch-open',
        journalId: 'rjn_launch',
        message: 'Queued launch task.',
      }),
      task: createTask({
        id: 'tsk_launch',
        activeTaskEnvelopeId: 'env_launch',
        currentRunJournalId: 'rjn_launch',
      }),
      taskEnvelope: createTaskEnvelope({
        id: 'env_launch',
        taskId: 'tsk_launch',
      }),
      workingContext: {
        ...createdWorkingContext.value,
        activeTaskId: 'tsk_launch',
        openTaskIds: ['tsk_launch'],
        updatedAt: '2026-04-12T00:07:00.000Z',
      },
      workingContextEtag: createdWorkingContext.etag,
    });

    const launchRequested = await repositories.tasks.recordTaskLaunchRequest({
      idempotencyRecord: createIdempotencyRecord({
        id: 'idr_launch-request',
        key: 'launch-request-1',
        scope: 'hands:start-request',
        status: 'reserved',
        resultReference: 'tsk_launch',
      }),
      task: {
        ...created.task.value,
        launchState: {
          status: 'requested',
          requestedAt: '2026-04-12T00:08:00.000Z',
          lastAttemptAt: '2026-04-12T00:08:00.000Z',
          lastIdempotencyKey: 'idem_launch-request',
          attemptCount: 1,
        },
        updatedAt: '2026-04-12T00:08:00.000Z',
      },
      taskEtag: created.task.etag,
      taskEnvelope: {
        ...created.taskEnvelope!.value,
        dispatchIdempotencyKey: 'idem_launch-request',
        updatedAt: '2026-04-12T00:08:00.000Z',
      },
      taskEnvelopeEtag: created.taskEnvelope!.etag,
    });

    expect(launchRequested.task.value.launchState.status).toBe('requested');
    expect(launchRequested.idempotencyRecord.value.status).toBe('reserved');

    const appended = await repositories.runJournals.appendEntryAndUpdateJournal({
      entry: createRunJournalEntry({
        id: 'rje_launch-progress',
        journalId: created.runJournal.value.id,
        entryKind: 'progress',
        message: 'Waiting for Hands startup.',
      }),
      journal: {
        ...created.runJournal.value,
        summary: 'Waiting for Hands startup.',
        lastEntryAt: '2026-04-12T00:08:30.000Z',
        updatedAt: '2026-04-12T00:08:30.000Z',
      },
      journalEtag: created.runJournal.etag,
      task: {
        ...launchRequested.task.value,
        progressSummary: {
          headline: 'Waiting for Hands startup.',
          waitingForUser: false,
          lastActor: 'system',
        },
        lastProgressAt: '2026-04-12T00:08:30.000Z',
        updatedAt: '2026-04-12T00:08:30.000Z',
      },
      taskEtag: launchRequested.task.etag,
    });

    expect(appended.journal.value.summary).toBe('Waiting for Hands startup.');
    expect(appended.task?.value.progressSummary?.headline).toBe(
      'Waiting for Hands startup.',
    );
  });

  it('writes blob-backed artifact metadata with default retention and cleanup support', async () => {
    const { artifactContentStore, repositories } = createTestSuite();
    await repositories.agents.create(createAgent());

    const storedArtifact = await repositories.artifacts.writeArtifact({
      artifact: createArtifact({ blobPath: 'pending-upload' }),
      body: 'artifact-contents',
    });

    expect(storedArtifact.value.blobPath).toBe('agents/agt_persistence/artifacts/art_persistence');
    expect(storedArtifact.value.retentionUntil).toBe('2026-04-26T00:00:00.000Z');
    expect(
      artifactContentStore.read('agents/agt_persistence/artifacts/art_persistence')?.toString('utf8'),
    ).toBe('artifact-contents');
  });

  it('encrypts, rotates, and revokes credentials without exposing plaintext in metadata', async () => {
    const { repositories } = createTestSuite();
    await repositories.agents.create(createAgent());

    const createdCredential = await repositories.credentials.createCredential({
      credentialRef: createCredentialRef(),
      plaintext: 'telegram-bot-token-v1',
    });

    expect(await repositories.credentials.decryptCredential('agt_persistence', 'crd_persistence')).toBe(
      'telegram-bot-token-v1',
    );

    const rotated = await repositories.credentials.rotateCredential({
      credentialRef: {
        ...createdCredential.credentialRef.value,
        updatedAt: '2026-04-12T00:20:00.000Z',
        lastRotatedAt: '2026-04-12T00:20:00.000Z',
      },
      expectedCredentialRefEtag: createdCredential.credentialRef.etag,
      plaintext: 'telegram-bot-token-v2',
    });

    expect(await repositories.credentials.decryptCredential('agt_persistence', 'crd_persistence')).toBe(
      'telegram-bot-token-v2',
    );

    await repositories.credentials.revokeCredential({
      credentialRef: {
        ...rotated.credentialRef.value,
        status: 'revoked',
        revokedAt: '2026-04-12T00:30:00.000Z',
        updatedAt: '2026-04-12T00:30:00.000Z',
      },
      expectedCredentialRefEtag: rotated.credentialRef.etag,
    });

    expect(await repositories.credentials.decryptCredential('agt_persistence', 'crd_persistence')).toBeNull();
  });

  it('materializes schedules idempotently and supports the remaining repository surfaces', async () => {
    const { repositories } = createTestSuite();
    await repositories.agents.create(createAgent());

    const createdWorkingContext = await repositories.workingContexts.create(createWorkingContext());
    expect((await repositories.workingContexts.getByAgent('agt_persistence'))?.value.id).toBe(
      createdWorkingContext.value.id,
    );

    const createdRunJournal = await repositories.runJournals.openJournal(createRunJournal());
    await repositories.runJournals.appendEntry(createRunJournalEntry());
    expect((await repositories.runJournals.listEntries('agt_persistence', createdRunJournal.value.id)).length).toBe(1);

    const createdTask = await repositories.tasks.createTask(createTask({ id: 'tsk_schedule-materialized' }));
    const materialized = await repositories.schedules.materializeDueSchedule({
      schedule: createSchedule({
        id: 'sch_materialized',
        lastMaterializedOccurrenceAt: '2026-04-12T00:00:00.000Z',
        nextDueAt: '2026-04-13T00:00:00.000Z',
      }),
      scheduleEtag: (
        await repositories.schedules.create(
          createSchedule({
            id: 'sch_materialized',
            nextDueAt: '2026-04-12T00:00:00.000Z',
          }),
        )
      ).etag,
      task: createTask({
        id: 'tsk_from-schedule',
        requestedBy: {
          kind: 'schedule',
          sourceScheduleId: 'sch_materialized',
        },
      }),
      taskEnvelope: createTaskEnvelope({
        id: 'env_from-schedule',
        taskId: 'tsk_from-schedule',
      }),
      idempotencyRecord: createIdempotencyRecord({
        id: 'idr_schedule',
        key: 'schedule-occurrence-1',
        resultReference: 'tsk_from-schedule',
      }),
    });

    expect(materialized.task.value.id).toBe('tsk_from-schedule');

    const createdHandsRun = await repositories.execution.claimHandsRun({
      handsRun: createHandsRun({
        id: 'hnd_claimed',
        taskId: createdTask.value.id,
        taskEnvelopeId: 'env_persistence',
      }),
      task: {
        ...createdTask.value,
        state: 'running',
        currentHandsRunId: 'hnd_claimed',
      },
      taskEtag: createdTask.etag,
    });
    expect(createdHandsRun.handsRun.value.state).toBe('queued');

    await repositories.execution.createSandboxSession(
      createSandboxSession({
        id: 'sbx_claimed',
        handsRunId: 'hnd_claimed',
        taskId: createdTask.value.id,
      }),
    );

    await repositories.usageEvents.append(createUsageEvent());
    expect((await repositories.usageEvents.listByAgent('agt_persistence')).length).toBe(1);
  });

  it('rejects duplicate create-only writes', async () => {
    const { repositories } = createTestSuite();
    await repositories.agents.create(createAgent());
    await repositories.usageEvents.append(createUsageEvent());

    await expect(repositories.usageEvents.append(createUsageEvent())).rejects.toBeInstanceOf(
      DuplicateRecordError,
    );
  });
});

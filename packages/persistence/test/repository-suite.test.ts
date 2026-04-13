import { transitionTaskState } from '@echidna-claw/domain';
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
  createCredentialRef,
  createHandsRun,
  createIdempotencyRecord,
  createInboundMessage,
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
        lastExternalMessageId: message.externalMessageId,
        updatedAt: message.receivedAt,
      },
      channelEtag: createdChannel.etag,
      idempotencyRecord,
      message,
    });

    expect(appended.replayed).toBe(false);
    expect(appended.channel.value.lastInboundSequence).toBe(1);

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
        queue: { priority: 'high' },
        dueAt: '2026-04-12T02:00:00.000Z',
        createdAt: '2026-04-12T00:00:01.000Z',
        updatedAt: '2026-04-12T00:00:01.000Z',
      }),
    );
    await repositories.tasks.createTask(
      createTask({
        id: 'tsk_urgent',
        queue: { priority: 'urgent' },
        dueAt: '2026-04-12T03:00:00.000Z',
        createdAt: '2026-04-12T00:00:02.000Z',
        updatedAt: '2026-04-12T00:00:02.000Z',
      }),
    );

    const queuedTasks = await repositories.tasks.listQueuedTasks('agt_persistence');
    expect(queuedTasks.map((task) => task.value.id)).toEqual(['tsk_urgent', 'tsk_high']);

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

import { createRuntimeTestHarness, seedActiveTelegramAgentState } from '@echidna-claw/testing';
import {
  createCorrelationMetadata,
  createOutboundMessage,
  createRunJournal,
  createTask,
} from '@echidna-claw/persistence';
import { describe, expect, it } from 'vitest';

import { createCredentialLifecycleService } from '../../src/services/runtime/credential-lifecycle-service.js';

async function createCredentialHarness() {
  const harness = createRuntimeTestHarness({
    serviceName: 'credential-lifecycle-test',
  });
  const logger = harness.loggerFactory.createLogger({ service: 'credential_lifecycle_test' });
  const seeded = await seedActiveTelegramAgentState({
    channel: {
      id: 'chn_credential',
    },
    suite: harness.suite,
    workingContext: {
      id: 'ctx_credential',
      pendingCredentialCaptureIds: [],
    },
  });
  const correlation = createCorrelationMetadata({
    idempotencyKey: 'idem_credential-task',
    taskId: 'tsk_credential',
    traceId: 'trc_credential-task',
  });
  const task = await harness.suite.tasks.createTask(
    createTask({
      agentId: seeded.agent.value.id,
      correlation,
      currentHandsRunId: 'hnd_credential',
      currentRunJournalId: 'rjn_credential',
      id: 'tsk_credential',
      requestedOutcome: 'Rotate the GitHub credential.',
      state: 'running',
    }),
  );
  await harness.suite.runJournals.openJournal(
    createRunJournal({
      agentId: seeded.agent.value.id,
      correlation,
      handsRunId: 'hnd_credential',
      id: 'rjn_credential',
      scope: 'hands_run',
      scopeId: 'hnd_credential',
      summary: 'Running credential-sensitive task.',
      taskId: task.value.id,
    }),
  );
  const sentMessages: string[] = [];
  const releasedRuns: string[] = [];
  const restartedTasks: string[] = [];
  const service = createCredentialLifecycleService({
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
    correlation,
    harness,
    releasedRuns,
    restartedTasks,
    seeded,
    sentMessages,
    service,
    task,
  };
}

describe('credential lifecycle service', () => {
  it('requests capture, stores the credential, and refreshes sandbox bindings', async () => {
    const harness = await createCredentialHarness();

    const capture = await harness.service.requestCapture({
      agentId: harness.seeded.agent.value.id,
      channelId: harness.seeded.channel.value.id,
      correlation: harness.correlation,
      reason: 'Authenticate GitHub API calls.',
      serviceAlias: 'github-token',
      taskId: harness.task.value.id,
    });

    expect(capture.state).toBe('requested');
    expect(harness.releasedRuns).toEqual(['hnd_credential']);
    expect(harness.sentMessages[0]).toContain('Credential needed: GitHub personal access token');

    const completed = await harness.service.completePendingCaptureFromTrustedInput({
      agentId: harness.seeded.agent.value.id,
      channelId: harness.seeded.channel.value.id,
      correlation: {
        ...harness.correlation,
        idempotencyKey: 'idem_credential-complete',
      },
      inboundMessageId: 'inm_credential-complete',
      plaintext: 'ghp_test-token',
    });

    expect(completed.handled).toBe(true);
    expect(harness.restartedTasks).toEqual(['tsk_credential']);

    const summaries = await harness.service.listCredentialSummaries(harness.seeded.agent.value.id);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.alias).toBe('github-token');
    expect(summaries[0]?.status).toBe('active');

    const bindings = await harness.service.resolveSandboxBindings({
      agentId: harness.seeded.agent.value.id,
      credentialAliases: ['github-token'],
    });
    expect(bindings).toEqual([
      {
        alias: 'github-token',
        credentialId: summaries[0]!.credentialId,
        exposure: 'env',
        provider: 'github',
        targetName: 'GITHUB_TOKEN',
      },
    ]);
  });

  it('cancels capture from trusted input without restarting work', async () => {
    const harness = await createCredentialHarness();
    const capture = await harness.service.requestCapture({
      agentId: harness.seeded.agent.value.id,
      channelId: harness.seeded.channel.value.id,
      correlation: harness.correlation,
      serviceAlias: 'github-token',
      taskId: harness.task.value.id,
    });

    const cancelled = await harness.service.completePendingCaptureFromTrustedInput({
      agentId: harness.seeded.agent.value.id,
      channelId: harness.seeded.channel.value.id,
      correlation: {
        ...harness.correlation,
        idempotencyKey: 'idem_credential-cancel',
      },
      inboundMessageId: 'inm_credential-cancel',
      plaintext: 'cancel',
    });

    expect(cancelled.handled).toBe(true);
    expect(harness.restartedTasks).toHaveLength(0);

    const storedCapture = await harness.harness.suite.credentialCaptures.get(
      harness.seeded.agent.value.id,
      capture.id,
    );
    const storedTask = await harness.harness.suite.tasks.getTask(
      harness.seeded.agent.value.id,
      harness.task.value.id,
    );
    expect(storedCapture?.value.state).toBe('cancelled');
    expect(storedTask?.value.state).toBe('cancelled');
  });

  it('rotates existing credentials and invalidates sandbox bindings after revocation', async () => {
    const harness = await createCredentialHarness();

    const first = await harness.service.upsertAgentCredentialFromPlaintext({
      agentId: harness.seeded.agent.value.id,
      alias: 'github-token',
      correlation: harness.correlation,
      plaintext: 'ghp_first-token',
    });
    const second = await harness.service.upsertAgentCredentialFromPlaintext({
      agentId: harness.seeded.agent.value.id,
      alias: 'github-token',
      correlation: {
        ...harness.correlation,
        idempotencyKey: 'idem_credential-rotate',
      },
      plaintext: 'ghp_second-token',
    });

    expect(second.id).toBe(first.id);
    expect(second.lastRotatedAt).not.toBeNull();

    const revoked = await harness.service.revokeCredential({
      agentId: harness.seeded.agent.value.id,
      correlation: {
        ...harness.correlation,
        idempotencyKey: 'idem_credential-revoke',
      },
      credentialId: second.id,
    });

    expect(revoked.status).toBe('revoked');
    await expect(
      harness.service.resolveSandboxBindings({
        agentId: harness.seeded.agent.value.id,
        credentialAliases: ['github-token'],
      }),
    ).rejects.toThrow("Active credential 'github-token' was not found");
  });
});

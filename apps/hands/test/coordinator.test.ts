import { createRuntimeTestHarness } from '@echidna-claw/testing';
import {
  createAgent,
  createCorrelationMetadata,
  createRunJournal,
  createRunJournalEntry,
  createSandboxSession,
  createTask,
  createTaskEnvelope,
  createWorkingContext,
} from '@echidna-claw/persistence';
import { createHandsExecutionCoordinator } from '@echidna-claw/hands-runtime';
import { describe, expect, it } from 'vitest';

async function seedQueuedHandsTask(input: {
  agentId?: string;
  dispatchIdempotencyKey?: string;
  requestedOutcome: string;
  runtimeScript: Record<string, unknown>;
  taskId?: string;
}) {
  const harness = createRuntimeTestHarness({
    serviceName: 'hands-coordinator-test',
  });
  const logger = harness.loggerFactory.createLogger({ service: 'hands_coordinator_test' });
  const agentId = input.agentId ?? 'agt_hands';
  const dispatchIdempotencyKey = input.dispatchIdempotencyKey ?? `idem_dispatch-${agentId}`;
  const taskId = input.taskId ?? 'tsk_hands';
  const correlation = createCorrelationMetadata({
    idempotencyKey: 'idem_hands-seed',
    taskId,
    traceId: 'trc_hands-seed',
  });

  await harness.suite.agents.create(
    createAgent({
      correlation,
      id: agentId,
      primaryChannelId: 'chn_hands',
    }),
  );
  const workingContext = await harness.suite.workingContexts.create(
    createWorkingContext({
      agentId,
      correlation,
      id: 'ctx_hands',
      activeTaskId: taskId,
      openTaskIds: [taskId],
      summary: 'Hands runtime context.',
    }),
  );
  const created = await harness.suite.tasks.createTaskWithEnvelope({
    runJournal: createRunJournal({
      agentId,
      correlation,
      handsRunId: null,
      id: 'rjn_hands',
      scope: 'head_turn',
      scopeId: 'hdr_hands',
      summary: 'Queued Hands task.',
      taskId,
    }),
    runJournalEntry: createRunJournalEntry({
      agentId,
      correlation,
      id: 'rje_hands-open',
      journalId: 'rjn_hands',
      message: 'Queued Hands task.',
    }),
    task: createTask({
      agentId,
      activeTaskEnvelopeId: 'env_hands',
      correlation,
      currentHandsRunId: null,
      currentRunJournalId: 'rjn_hands',
      id: taskId,
      notes: JSON.stringify(input.runtimeScript),
      requestedOutcome: input.requestedOutcome,
      state: 'queued',
      type: 'follow_up',
    }),
    taskEnvelope: createTaskEnvelope({
      agentId,
      dispatchIdempotencyKey,
      correlation,
      id: 'env_hands',
      notes: JSON.stringify(input.runtimeScript),
      requestedOutcome: input.requestedOutcome,
      taskId,
      taskType: 'follow_up',
    }),
    workingContext: {
      ...workingContext.value,
      updatedAt: '2026-04-12T00:00:00.000Z',
    },
    workingContextEtag: workingContext.etag,
  });

  return {
    created,
    harness,
    logger,
  };
}

describe('Hands execution coordinator', () => {
  it('completes scripted runs, closes sandbox sessions, and enqueues follow-up tasks', async () => {
    const seeded = await seedQueuedHandsTask({
      dispatchIdempotencyKey: 'idem_hands-dispatch',
      requestedOutcome: 'Verify the packaged deployment.',
      runtimeScript: {
        followUpTasks: [
          {
            notes: 'Collect rollout logs.',
            priority: 'normal',
            requestedOutcome: 'Collect rollout logs.',
            taskType: 'follow_up',
          },
        ],
        outcome: 'completed',
        sandboxCommand: {
          command: 'echo sandbox-ok',
          packageAllowlistName: 'default-runtime-pnpm',
        },
        summary: 'Hands completed the verification.',
      },
    });
    const followUpRequests: string[] = [];
    const sandboxEvents: string[] = [];
    const coordinator = createHandsExecutionCoordinator({
      followUpQueue: {
        async enqueueFollowUpTasks(input) {
          followUpRequests.push(...input.followUpTasks.map((task) => task.requestedOutcome));
          return {
            results: input.followUpTasks.map((task, index) => ({
              disposition: 'created_new_task' as const,
              runJournalId: null,
              startRequest: null,
              taskEnvelopeId: `env_followup_${index + 1}`,
              taskId: `tsk_followup_${index + 1}`,
              taskState: 'queued' as const,
            })),
          };
        },
      },
      logger: seeded.logger,
      repositories: {
        agents: seeded.harness.suite.agents,
        execution: seeded.harness.suite.execution,
        tasks: seeded.harness.suite.tasks,
        workingContexts: seeded.harness.suite.workingContexts,
      },
      sandbox: {
        async closeSession(input) {
          sandboxEvents.push(`close:${input.sessionId}:${input.reason}`);
          return createSandboxSession({
            completedAt: '2026-04-12T00:03:00.000Z',
            id: input.sessionId,
            state: input.reason === 'cancelled' ? 'cancelled' : 'completed',
          });
        },
        async createSession() {
          sandboxEvents.push('create:sbx_1234567890abcdef12345678');
          return createSandboxSession({
            id: 'sbx_1234567890abcdef12345678',
          });
        },
        async executeCommand(input) {
          sandboxEvents.push(`execute:${input.sessionId}:${input.command}`);
          return {
            artifactIds: [],
            completedAt: '2026-04-12T00:02:00.000Z',
            durationMs: 10,
            exitCode: 0,
            failureCode: undefined,
            failureMessage: undefined,
            outputTruncated: false,
            resolvedWorkingDirectory: '/tmp/work',
            sessionId: input.sessionId,
            signal: null,
            startedAt: '2026-04-12T00:01:59.000Z',
            status: 'completed' as const,
            stderrText: '',
            stdoutText: 'sandbox-ok',
          };
        },
        async getSession(sessionId) {
          return createSandboxSession({
            id: sessionId,
          });
        },
      },
      workerInstanceId: 'hands-worker-test',
    });

    const result = await coordinator.executeDispatchedRun({
      agentId: seeded.created.task.value.agentId,
      attemptNumber: 1,
      correlation: createCorrelationMetadata({
        handsRunId: 'hnd_runtime',
        idempotencyKey: 'idem_hands-dispatch',
        taskId: seeded.created.task.value.id,
        traceId: 'trc_hands-dispatch',
      }),
      dispatchIdempotencyKey: 'idem_hands-dispatch',
      taskEnvelopeId: seeded.created.taskEnvelope!.value.id,
      taskId: seeded.created.task.value.id,
    });

    expect(result.startupOutcome).toBe('claimed_new_run');
    expect(result.taskState).toBe('completed');
    expect(followUpRequests).toEqual(['Collect rollout logs.']);
    expect(sandboxEvents).toEqual([
      expect.stringMatching(/^create:sbx_/),
      expect.stringMatching(/^execute:sbx_.*:echo sandbox-ok$/),
      expect.stringMatching(/^close:sbx_.*:completed$/),
    ]);
  });

  it('records scripted failures as failed tasks', async () => {
    const seeded = await seedQueuedHandsTask({
      dispatchIdempotencyKey: 'idem_hands-dispatch-failed',
      requestedOutcome: 'Fail the scripted run.',
      runtimeScript: {
        failureCode: 'runtime_test_failed',
        failureMessage: 'The scripted test asked Hands to fail.',
        outcome: 'failed',
        summary: 'Hands failed the scripted run.',
      },
      taskId: 'tsk_hands-failed',
    });
    const coordinator = createHandsExecutionCoordinator({
      followUpQueue: {
        async enqueueFollowUpTasks() {
          return {
            results: [],
          };
        },
      },
      logger: seeded.logger,
      repositories: {
        agents: seeded.harness.suite.agents,
        execution: seeded.harness.suite.execution,
        tasks: seeded.harness.suite.tasks,
        workingContexts: seeded.harness.suite.workingContexts,
      },
      sandbox: {
        async closeSession(input) {
          return createSandboxSession({
            id: input.sessionId,
          });
        },
        async createSession() {
          return createSandboxSession({
            id: 'sbx_abcdefabcdefabcdefabcdef',
          });
        },
        async executeCommand(input) {
          return {
            artifactIds: [],
            completedAt: '2026-04-12T00:02:00.000Z',
            durationMs: 10,
            exitCode: 0,
            failureCode: undefined,
            failureMessage: undefined,
            outputTruncated: false,
            resolvedWorkingDirectory: '/tmp/work',
            sessionId: input.sessionId,
            signal: null,
            startedAt: '2026-04-12T00:01:59.000Z',
            status: 'completed' as const,
            stderrText: '',
            stdoutText: 'sandbox-ok',
          };
        },
        async getSession(sessionId) {
          return createSandboxSession({
            id: sessionId,
          });
        },
      },
      workerInstanceId: 'hands-worker-test',
    });

    const result = await coordinator.executeDispatchedRun({
      agentId: seeded.created.task.value.agentId,
      attemptNumber: 1,
      correlation: createCorrelationMetadata({
        handsRunId: 'hnd_runtime-failed',
        idempotencyKey: 'idem_hands-dispatch-failed',
        taskId: seeded.created.task.value.id,
        traceId: 'trc_hands-dispatch-failed',
      }),
      dispatchIdempotencyKey: 'idem_hands-dispatch-failed',
      taskEnvelopeId: seeded.created.taskEnvelope!.value.id,
      taskId: seeded.created.task.value.id,
    });

    expect(result.taskState).toBe('failed');

    const storedTask = await seeded.harness.suite.tasks.getTask(
      seeded.created.task.value.agentId,
      seeded.created.task.value.id,
    );
    expect(storedTask?.value.state).toBe('failed');
  });

  it('supports scripted cancellation outcomes without follow-up work', async () => {
    const seeded = await seedQueuedHandsTask({
      dispatchIdempotencyKey: 'idem_hands-dispatch-cancelled',
      requestedOutcome: 'Cancel the scripted run.',
      runtimeScript: {
        outcome: 'cancelled',
        resultCode: 'cancelled',
        summary: 'Hands cancelled the scripted run.',
      },
      taskId: 'tsk_hands-cancelled',
    });
    const coordinator = createHandsExecutionCoordinator({
      followUpQueue: {
        async enqueueFollowUpTasks() {
          return {
            results: [],
          };
        },
      },
      logger: seeded.logger,
      repositories: {
        agents: seeded.harness.suite.agents,
        execution: seeded.harness.suite.execution,
        tasks: seeded.harness.suite.tasks,
        workingContexts: seeded.harness.suite.workingContexts,
      },
      sandbox: {
        async closeSession(input) {
          return createSandboxSession({
            id: input.sessionId,
          });
        },
        async createSession() {
          return createSandboxSession({
            id: 'sbx_fedcbafedcbafedcbafedcba',
          });
        },
        async executeCommand(input) {
          return {
            artifactIds: [],
            completedAt: '2026-04-12T00:02:00.000Z',
            durationMs: 10,
            exitCode: 0,
            failureCode: undefined,
            failureMessage: undefined,
            outputTruncated: false,
            resolvedWorkingDirectory: '/tmp/work',
            sessionId: input.sessionId,
            signal: null,
            startedAt: '2026-04-12T00:01:59.000Z',
            status: 'completed' as const,
            stderrText: '',
            stdoutText: 'sandbox-ok',
          };
        },
        async getSession(sessionId) {
          return createSandboxSession({
            id: sessionId,
          });
        },
      },
      workerInstanceId: 'hands-worker-test',
    });

    const result = await coordinator.executeDispatchedRun({
      agentId: seeded.created.task.value.agentId,
      attemptNumber: 1,
      correlation: createCorrelationMetadata({
        handsRunId: 'hnd_runtime-cancelled',
        idempotencyKey: 'idem_hands-dispatch-cancelled',
        taskId: seeded.created.task.value.id,
        traceId: 'trc_hands-dispatch-cancelled',
      }),
      dispatchIdempotencyKey: 'idem_hands-dispatch-cancelled',
      taskEnvelopeId: seeded.created.taskEnvelope!.value.id,
      taskId: seeded.created.task.value.id,
    });

    expect(result.taskState).toBe('cancelled');
  });
});

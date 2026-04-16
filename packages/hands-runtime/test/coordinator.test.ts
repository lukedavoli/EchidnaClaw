import type {
  HandsEnqueueFollowUpRequest,
  HandsFollowUpTaskRequest,
  HandsStartRunRequest,
} from '@echidna-claw/contracts';
import { createLoggerFactory } from '@echidna-claw/observability';
import {
  FIXTURE_TIMESTAMP,
  createAgent,
  createCorrelationMetadata,
  createHandsRun,
  createInMemoryRepositorySuite,
  createRunJournal,
  createRunJournalEntry,
  createTask,
  createTaskEnvelope,
  createWorkingContext,
  type RepositorySuite,
} from '@echidna-claw/persistence';
import { describe, expect, it } from 'vitest';

import { createHandsExecutionCoordinator, type HandsTaskHandler } from '../src/index.js';

type RuntimeHarness = {
  agentId: string;
  coordinator: ReturnType<typeof createHandsExecutionCoordinator>;
  dispatchIdempotencyKey: string;
  followUpRequests: HandsEnqueueFollowUpRequest[];
  startRequest: HandsStartRunRequest;
  suite: RepositorySuite;
  taskId: string;
  workingContextId: string;
};

const loggerFactory = createLoggerFactory({
  level: 'debug',
  serviceName: 'hands-runtime-test',
  sink: () => {},
});

function createFollowUpTask(
  overrides: Partial<HandsFollowUpTaskRequest> = {},
): HandsFollowUpTaskRequest {
  return {
    dueAt: null,
    externalReferences: [],
    lane: 'follow_up',
    notes: '',
    priority: 'normal',
    requestedOutcome: 'Review the follow-up outcome.',
    startRequested: false,
    taskType: 'follow_up',
    ...overrides,
  };
}

async function createRuntimeHarness(input?: {
  handlers?: readonly HandsTaskHandler[];
  notes?: string;
  now?: () => string;
  suite?: RepositorySuite;
  taskType?: string;
}): Promise<RuntimeHarness> {
  const suite = input?.suite ?? createInMemoryRepositorySuite();
  const agentId = 'agt_hands-runtime';
  const taskId = 'tsk_hands-runtime';
  const taskEnvelopeId = 'env_hands-runtime';
  const runJournalId = 'rjn_hands-queue';
  const workingContextId = 'ctx_hands-runtime';
  const dispatchIdempotencyKey = 'idem_hands-runtime-dispatch';

  await suite.agents.create(
    createAgent({
      id: agentId,
      correlation: createCorrelationMetadata({
        idempotencyKey: 'idem_hands-runtime-agent',
        traceId: 'trc_hands-runtime-agent',
      }),
      primaryChannelId: 'chn_hands-runtime',
    }),
  );
  const storedWorkingContext = await suite.workingContexts.create(
    createWorkingContext({
      agentId,
      correlation: createCorrelationMetadata({
        idempotencyKey: 'idem_hands-runtime-context',
        traceId: 'trc_hands-runtime-context',
      }),
      id: workingContextId,
      openTaskIds: [],
      summary: 'Hands runtime test summary.',
      summaryUpdatedAt: FIXTURE_TIMESTAMP,
    }),
  );

  const task = createTask({
    activeTaskEnvelopeId: taskEnvelopeId,
    agentId,
    correlation: createCorrelationMetadata({
      idempotencyKey: 'idem_hands-runtime-task',
      taskId,
      traceId: 'trc_hands-runtime-task',
    }),
    currentHandsRunId: null,
    currentRunJournalId: runJournalId,
    id: taskId,
    launchState: {
      attemptCount: 1,
      lastAttemptAt: FIXTURE_TIMESTAMP,
      lastIdempotencyKey: dispatchIdempotencyKey,
      requestedAt: FIXTURE_TIMESTAMP,
      status: 'requested',
    },
    queue: {
      lane: 'follow_up',
      priority: 'normal',
    },
    requestedOutcome: 'Verify the Hands worker runtime.',
    state: 'queued',
    type: input?.taskType ?? 'runtime_test',
  });
  const taskEnvelope = createTaskEnvelope({
    agentId,
    attemptNumber: 1,
    correlation: createCorrelationMetadata({
      idempotencyKey: 'idem_hands-runtime-envelope',
      taskId,
      traceId: 'trc_hands-runtime-envelope',
    }),
    dispatchIdempotencyKey,
    id: taskEnvelopeId,
    notes: input?.notes ?? JSON.stringify({ summary: 'Completed runtime task.' }),
    queue: task.queue,
    requestedOutcome: task.requestedOutcome,
    taskId,
    taskType: task.type,
  });
  const queueJournal = createRunJournal({
    agentId,
    correlation: createCorrelationMetadata({
      idempotencyKey: 'idem_hands-runtime-queue-journal',
      taskId,
      traceId: 'trc_hands-runtime-queue-journal',
    }),
    handsRunId: null,
    id: runJournalId,
    progressSummary: task.progressSummary,
    scope: 'head_turn',
    scopeId: `queue-${workingContextId}`,
    summary: task.progressSummary?.headline ?? '',
    taskId,
  });
  const queueJournalEntry = createRunJournalEntry({
    agentId,
    correlation: createCorrelationMetadata({
      idempotencyKey: 'idem_hands-runtime-queue-entry',
      taskId,
      traceId: 'trc_hands-runtime-queue-entry',
    }),
    journalId: runJournalId,
    message: 'Queued task awaiting Hands startup.',
    taskStateAfter: 'queued',
  });

  await suite.tasks.createTaskWithEnvelope({
    runJournal: queueJournal,
    runJournalEntry: queueJournalEntry,
    task,
    taskEnvelope,
    workingContext: {
      ...storedWorkingContext.value,
      activeTaskId: taskId,
      openTaskIds: [taskId],
      updatedAt: FIXTURE_TIMESTAMP,
    },
    workingContextEtag: storedWorkingContext.etag,
  });

  const followUpRequests: HandsEnqueueFollowUpRequest[] = [];
  const coordinator = createHandsExecutionCoordinator({
    followUpQueue: {
      async enqueueFollowUpTasks(request) {
        followUpRequests.push(request);
        return {
          results: request.followUpTasks.map((task, index) => ({
            disposition: 'created_new_task' as const,
            runJournalId: `rjn_follow-up-${index + 1}`,
            startRequest: null,
            taskEnvelopeId: `env_follow-up-${index + 1}`,
            taskId: `tsk_follow-up-${index + 1}`,
          })),
        };
      },
    },
    ...(input?.handlers ? { handlers: input.handlers } : {}),
    logger: loggerFactory.createLogger({ component: 'coordinator_test' }),
    ...(input?.now ? { now: input.now } : {}),
    repositories: {
      agents: suite.agents,
      execution: suite.execution,
      tasks: suite.tasks,
      workingContexts: suite.workingContexts,
    },
    sandbox: {
      async closeSession(input) {
        return {
          agentId,
          allowedOutboundHosts: [],
          closedReason: input.reason,
          commandCount: 0,
          completedAt: FIXTURE_TIMESTAMP,
          correlation: createCorrelationMetadata({
            handsRunId: input.correlation.handsRunId,
            sandboxSessionId: input.sessionId,
            taskId,
          }),
          createdAt: FIXTURE_TIMESTAMP,
          credentialAliases: [],
          failureCode: null,
          handsRunId: input.correlation.handsRunId ?? 'hnd_sandbox-test',
          id: input.sessionId,
          lastCommandCompletedAt: null,
          lastCommandStartedAt: null,
          packageAllowlistName: 'default-runtime-pnpm',
          policyName: 'standard',
          recordType: 'sandbox_session',
          resourceProfile: {
            defaultTimeoutMs: 10000,
            maxCpuSeconds: 30,
            maxMemoryMb: 1024,
            maxOutputBytes: 32768,
            maxTimeoutMs: 60000,
          },
          schemaVersion: 1,
          startedAt: FIXTURE_TIMESTAMP,
          state: 'closed',
          taskId,
          updatedAt: FIXTURE_TIMESTAMP,
          workingDirectory: 'C:/tmp/hands-runtime-test',
          workspaceRoot: 'C:/tmp/hands-runtime-test',
        };
      },
      async createSession(input) {
        return {
          agentId: input.agentId,
          allowedOutboundHosts: [],
          closedReason: null,
          commandCount: 0,
          completedAt: null,
          correlation: input.correlation,
          createdAt: FIXTURE_TIMESTAMP,
          credentialAliases: input.credentialAliases,
          failureCode: null,
          handsRunId: input.handsRunId,
          id: 'sbx_hands-runtime',
          lastCommandCompletedAt: null,
          lastCommandStartedAt: null,
          packageAllowlistName: input.packageAllowlistName,
          policyName: input.policyName,
          recordType: 'sandbox_session',
          resourceProfile: {
            defaultTimeoutMs: 10000,
            maxCpuSeconds: 30,
            maxMemoryMb: 1024,
            maxOutputBytes: 32768,
            maxTimeoutMs: 60000,
          },
          schemaVersion: 1,
          startedAt: FIXTURE_TIMESTAMP,
          state: 'created',
          taskId: input.taskId,
          updatedAt: FIXTURE_TIMESTAMP,
          workingDirectory: input.workingDirectory ?? 'C:/tmp/hands-runtime-test',
          workspaceRoot: 'C:/tmp/hands-runtime-test',
        };
      },
      async executeCommand() {
        return {
          command: 'echo ok',
          completedAt: FIXTURE_TIMESTAMP,
          exitCode: 0,
          startedAt: FIXTURE_TIMESTAMP,
          status: 'completed' as const,
          stderrText: '',
          stdoutText: 'ok',
        };
      },
      async getSession() {
        throw new Error('Sandbox session lookup is not used in this test.');
      },
    },
    workerInstanceId: 'hands-runtime-test-worker',
  });

  return {
    agentId,
    coordinator,
    dispatchIdempotencyKey,
    followUpRequests,
    startRequest: {
      agentId,
      attemptNumber: 1,
      correlation: createCorrelationMetadata({
        idempotencyKey: dispatchIdempotencyKey,
        taskId,
        traceId: 'trc_hands-runtime-dispatch',
      }),
      dispatchIdempotencyKey,
      taskEnvelopeId,
      taskId,
    },
    suite,
    taskId,
    workingContextId,
  };
}

describe('createHandsExecutionCoordinator', () => {
  it('claims queued work, records progress, enqueues follow-up tasks, and finalizes completion', async () => {
    const harness = await createRuntimeHarness({
      notes: JSON.stringify({
        followUpTasks: [
          createFollowUpTask({
            requestedOutcome: 'Confirm the follow-up remediation.',
          }),
        ],
        progressMessages: ['Fetched the latest deployment summary.'],
        summary: 'Completed runtime task.',
      }),
      now: () => '2026-04-12T00:10:00.000Z',
    });

    const result = await harness.coordinator.executeDispatchedRun(harness.startRequest);

    expect(result).toMatchObject({
      startupOutcome: 'claimed_new_run',
      summary: 'Completed runtime task.',
      taskId: harness.taskId,
      taskState: 'completed',
    });

    const storedTask = await harness.suite.tasks.getTask(harness.agentId, harness.taskId);
    const storedHandsRun = await harness.suite.execution.findHandsRunByDispatchKey(
      harness.agentId,
      harness.dispatchIdempotencyKey,
    );
    const storedWorkingContext = await harness.suite.workingContexts.get(
      harness.agentId,
      harness.workingContextId,
    );

    expect(storedTask?.value.state).toBe('completed');
    expect(storedTask?.value.currentHandsRunId).toBeNull();
    expect(storedTask?.value.progressSummary?.headline).toBe('Completed runtime task.');
    expect(storedHandsRun?.value.state).toBe('completed');
    expect(storedHandsRun?.value.resultCode).toBe('completed');
    expect(storedWorkingContext?.value.latestHandsStatus).toBe('Completed runtime task.');
    expect(storedWorkingContext?.value.openTaskIds).not.toContain(harness.taskId);

    expect(harness.followUpRequests).toHaveLength(1);
    expect(harness.followUpRequests[0]).toMatchObject({
      agentId: harness.agentId,
      taskId: harness.taskId,
      workingContextId: harness.workingContextId,
    });

    const entries = await harness.suite.runJournals.listEntries(
      harness.agentId,
      storedTask!.value.currentRunJournalId!,
    );
    expect(entries.at(-1)?.value.message).toBe('Completed runtime task.');
    expect(entries.some((entry) => entry.value.handsActionSummary?.includes('Created follow-up tasks:'))).toBe(true);
  });

  it('returns replayed_existing_run for duplicate dispatches after the run has already been claimed', async () => {
    const harness = await createRuntimeHarness({
      notes: JSON.stringify({
        summary: 'Completed replayable runtime task.',
      }),
      now: () => '2026-04-12T00:11:00.000Z',
    });

    const first = await harness.coordinator.executeDispatchedRun(harness.startRequest);
    const replay = await harness.coordinator.executeDispatchedRun(harness.startRequest);

    expect(first.startupOutcome).toBe('claimed_new_run');
    expect(replay).toMatchObject({
      handsRunId: first.handsRunId,
      startupOutcome: 'replayed_existing_run',
      taskId: harness.taskId,
      taskState: 'completed',
    });
  });

  it('returns agent_busy and leaves the task queued when another Hands run is already active', async () => {
    const harness = await createRuntimeHarness({
      now: () => '2026-04-12T00:12:00.000Z',
    });

    await harness.suite.execution.createHandsRun(
      createHandsRun({
        agentId: harness.agentId,
        claimedAt: '2026-04-12T00:11:00.000Z',
        correlation: createCorrelationMetadata({
          handsRunId: 'hnd_other-active',
          idempotencyKey: 'idem_hands-runtime-other',
          taskId: 'tsk_other-active',
          traceId: 'trc_hands-runtime-other',
        }),
        dispatchIdempotencyKey: 'idem_hands-runtime-other',
        id: 'hnd_other-active',
        lastHeartbeatAt: '2026-04-12T00:11:30.000Z',
        startedAt: '2026-04-12T00:11:00.000Z',
        state: 'running',
        taskEnvelopeId: 'env_other-active',
        taskId: 'tsk_other-active',
        workerInstanceId: 'hands-runtime-other-worker',
      }),
    );

    const result = await harness.coordinator.executeDispatchedRun(harness.startRequest);
    const storedTask = await harness.suite.tasks.getTask(harness.agentId, harness.taskId);
    const storedHandsRun = await harness.suite.execution.findHandsRunByDispatchKey(
      harness.agentId,
      harness.dispatchIdempotencyKey,
    );

    expect(result).toMatchObject({
      handsRunId: null,
      startupOutcome: 'agent_busy',
      taskId: harness.taskId,
      taskState: 'queued',
    });
    expect(storedTask?.value.state).toBe('queued');
    expect(storedTask?.value.currentHandsRunId).toBeNull();
    expect(storedHandsRun).toBeNull();
  });

  it.each([
    {
      expectedTaskState: 'waiting_for_user' as const,
      name: 'waiting_for_user',
      openQuestions: ['Need user approval before continuing.'],
      resultCode: null,
      runState: 'waiting_for_user' as const,
      script: {
        openQuestions: ['Need user approval before continuing.'],
        outcome: 'waiting_for_user',
        summary: 'Waiting for user confirmation.',
      },
    },
    {
      expectedTaskState: 'deferred' as const,
      name: 'deferred',
      openQuestions: [] as string[],
      resultCode: 'deferred',
      runState: 'completed' as const,
      script: {
        dueAt: '2026-04-12T01:30:00.000Z',
        outcome: 'deferred',
        summary: 'Deferred until the maintenance window opens.',
      },
    },
    {
      expectedTaskState: 'failed' as const,
      name: 'failed',
      openQuestions: [] as string[],
      resultCode: null,
      runState: 'failed' as const,
      script: {
        failureCode: 'runtime_test_failed',
        failureMessage: 'The scripted runtime test requested a failure.',
        outcome: 'failed',
        summary: 'Hands runtime failed its scripted check.',
      },
    },
  ])('maps the $name handler outcome into durable task and run state', async (scenario) => {
    const harness = await createRuntimeHarness({
      notes: JSON.stringify(scenario.script),
      now: () => '2026-04-12T00:13:00.000Z',
    });

    const result = await harness.coordinator.executeDispatchedRun(harness.startRequest);
    const storedTask = await harness.suite.tasks.getTask(harness.agentId, harness.taskId);
    const storedHandsRun = await harness.suite.execution.findHandsRunByDispatchKey(
      harness.agentId,
      harness.dispatchIdempotencyKey,
    );
    const storedWorkingContext = await harness.suite.workingContexts.get(
      harness.agentId,
      harness.workingContextId,
    );

    expect(result.taskState).toBe(scenario.expectedTaskState);
    expect(storedTask?.value.state).toBe(scenario.expectedTaskState);
    expect(storedHandsRun?.value.state).toBe(scenario.runState);
    expect(storedHandsRun?.value.resultCode).toBe(scenario.resultCode);
    expect(storedWorkingContext?.value.latestHandsStatus).toBe(scenario.script.summary);
    expect(storedWorkingContext?.value.openQuestions).toEqual(scenario.openQuestions);

    if (scenario.expectedTaskState === 'waiting_for_user') {
      expect(storedHandsRun?.value.releasedAt).toBe('2026-04-12T00:13:00.000Z');
      expect(storedWorkingContext?.value.openTaskIds).toContain(harness.taskId);
    }

    if (scenario.expectedTaskState === 'deferred') {
      expect(storedTask?.value.dueAt).toBe('2026-04-12T01:30:00.000Z');
      expect(storedWorkingContext?.value.openTaskIds).toContain(harness.taskId);
    }

    if (scenario.expectedTaskState === 'failed') {
      expect(storedHandsRun?.value.failureCode).toBe('runtime_test_failed');
      expect(storedWorkingContext?.value.openTaskIds).not.toContain(harness.taskId);
    }
  });

  it('observes cancellation at checkpoints and finalizes the task and run as cancelled', async () => {
    const suite = createInMemoryRepositorySuite();
    const cancellingHandler: HandsTaskHandler = {
      canHandle(taskType) {
        return taskType === 'runtime_test';
      },
      async execute(context) {
        const storedTask = await suite.tasks.getTask(context.task.agentId, context.task.id);
        expect(storedTask).not.toBeNull();

        await suite.tasks.replaceTask(
          {
            ...storedTask!.value,
            cancellationReason: 'Operator requested stop.',
            cancellationRequestedAt: '2026-04-12T00:14:00.000Z',
            updatedAt: '2026-04-12T00:14:00.000Z',
          },
          storedTask!.etag,
        );
        await context.checkpoint('after_external_cancel_request');

        return {
          artifactIds: [],
          externalReferences: [],
          followUpTasks: [],
          kind: 'completed',
          resultCode: 'completed',
          summary: 'This outcome should never be returned.',
        };
      },
    };
    const harness = await createRuntimeHarness({
      handlers: [cancellingHandler],
      now: () => '2026-04-12T00:14:00.000Z',
      suite,
    });

    const result = await harness.coordinator.executeDispatchedRun(harness.startRequest);
    const storedTask = await harness.suite.tasks.getTask(harness.agentId, harness.taskId);
    const storedHandsRun = await harness.suite.execution.findHandsRunByDispatchKey(
      harness.agentId,
      harness.dispatchIdempotencyKey,
    );
    const storedWorkingContext = await harness.suite.workingContexts.get(
      harness.agentId,
      harness.workingContextId,
    );

    expect(result).toMatchObject({
      startupOutcome: 'claimed_new_run',
      summary: 'Cancelled: Operator requested stop.',
      taskState: 'cancelled',
    });
    expect(storedTask?.value.state).toBe('cancelled');
    expect(storedTask?.value.lastCheckpointAt).toBe('2026-04-12T00:14:00.000Z');
    expect(storedHandsRun?.value.state).toBe('cancelled');
    expect(storedHandsRun?.value.cancelledAt).toBe('2026-04-12T00:14:00.000Z');
    expect(storedWorkingContext?.value.latestHandsStatus).toBe('Cancelled: Operator requested stop.');
    expect(storedWorkingContext?.value.openTaskIds).not.toContain(harness.taskId);
  });
});

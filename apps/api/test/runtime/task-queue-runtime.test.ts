import { createLoggerFactory } from '@echidna-claw/observability';
import {
  createAgent,
  createChannel,
  createCorrelationMetadata,
  createIdempotencyRecord,
  createInboundMessage,
  createInMemoryRepositorySuite,
  createWorkingContext,
} from '@echidna-claw/persistence';
import { loadRepositoryConfig } from '@echidna-claw/config';
import { describe, expect, it } from 'vitest';

import type { FoundryHeadTurnResult, HeadRuntimeAdapter, PreparedHeadTurnInput } from '../../src/adapters/foundry/index.js';
import type { HandsJobTriggerAdapter } from '../../src/adapters/jobs/index.js';
import { createTestApiConfig } from '../../src/testing/fixtures/api-config.js';
import { createHeadRuntimeService } from '../../src/services/runtime/head-runtime-service.js';
import { createTaskQueueService } from '../../src/services/runtime/task-queue-service.js';

function createEmptyEffectSummary() {
  return {
    taskRequested: false,
    scheduleChangeRequested: false,
    approvalRequested: false,
    credentialRequested: false,
    sandboxRequested: false,
    memoryOperationRequested: false,
  };
}

function createRepositoryBundle() {
  const suite = createInMemoryRepositorySuite();

  return {
    suite,
    repositories: {
      agents: suite.agents,
      agentRegistry: suite.agentRegistry,
      analytics: {
        async getOverview() {
          return {
            totalEstimatedCostUsd: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            events: [],
          };
        },
      },
      approvals: {
        async getState() {
          return 'requested' as const;
        },
      },
      channels: suite.channels,
      credentials: suite.credentials,
      execution: suite.execution,
      idempotency: suite.idempotency,
      messages: suite.messages,
      runJournals: suite.runJournals,
      schedules: suite.schedules,
      tasks: suite.tasks,
      workingContexts: suite.workingContexts,
    },
  };
}

async function seedTrustedMessageFlow(input: {
  messageId: string;
  messageText: string;
  repositories: ReturnType<typeof createRepositoryBundle>['repositories'];
  sequence: number;
}) {
  const messageSuffix = input.messageId.replace(/^inm_/, '').replace(/_/g, '-');
  const correlation = createCorrelationMetadata({
    idempotencyKey: `idem_${messageSuffix}`,
    traceId: `trc_${messageSuffix}`,
  });
  const existingAgent = await input.repositories.agents.get('agt_runtime');

  if (!existingAgent) {
    await input.repositories.agents.create(
      createAgent({
        id: 'agt_runtime',
        correlation,
        lifecycleState: 'active',
        primaryChannelId: 'chn_runtime',
        provisioningState: 'active',
      }),
    );
    await input.repositories.channels.create(
      createChannel({
        agentId: 'agt_runtime',
        correlation,
        id: 'chn_runtime',
        lastInboundSequence: 0,
        state: 'active',
      }),
    );
    await input.repositories.workingContexts.create(
      createWorkingContext({
        agentId: 'agt_runtime',
        correlation,
        id: 'ctx_runtime',
        latestInboundSequence: 0,
        latestProcessedSequence: 0,
        episodeLocalDate: null,
        episodeTurnCount: 0,
        summary: 'Deployment follow-up context.',
        summaryUpdatedAt: null,
        currentObjective: null,
      }),
    );
  }

  const storedChannel = await input.repositories.channels.get('agt_runtime', 'chn_runtime');
  const message = createInboundMessage({
    agentId: 'agt_runtime',
    body: {
      text: input.messageText,
      artifacts: [],
    },
    channelId: 'chn_runtime',
    correlation,
    id: input.messageId,
    sequence: input.sequence,
    trusted: true,
  });

  await input.repositories.messages.appendInboundMessage({
    channel: {
      ...storedChannel!.value,
      lastInboundSequence: input.sequence,
      lastExternalMessageId: message.externalMessageId,
      updatedAt: message.receivedAt,
    },
    channelEtag: storedChannel!.etag,
    idempotencyRecord: createIdempotencyRecord({
      agentId: 'agt_runtime',
      correlation,
      id: `idr_${messageSuffix}`,
      key: `tg-${input.messageId}`,
      resultReference: input.messageId,
    }),
    message,
  });

  return {
    agentId: 'agt_runtime',
    channelId: 'chn_runtime',
    inboundMessageId: input.messageId,
    workingContextId: 'ctx_runtime',
  };
}

function createToolCallingRuntime(
  toolName: string,
  args: Record<string, unknown>,
): HeadRuntimeAdapter {
  return {
    async cancelTurn(): Promise<void> {
      return;
    },
    async executeTurn(input: PreparedHeadTurnInput): Promise<FoundryHeadTurnResult> {
      const tool = input.enabledTools.find((candidate) => candidate.name === toolName);
      if (!tool) {
        throw new Error(`Missing tool ${toolName}.`);
      }

      const toolResult = await tool.execute(args);

      return {
        assistantText: toolResult.outputText,
        completionKind: 'reply',
        conversationCursor: `test-conversation:${input.headTurnId}`,
        deferredDirectives: toolResult.deferredDirectives ?? [],
        effectSummary: {
          ...createEmptyEffectSummary(),
          ...toolResult.effectSummaryPatch,
        },
        providerConversationId: `test-conversation:${input.headTurnId}`,
        providerRunId: `test-run:${input.headTurnId}`,
      };
    },
  };
}

function createHandsJobStub(startRunCalls: Array<Record<string, unknown>>): HandsJobTriggerAdapter {
  return {
    async releaseForUser() {
      throw new Error('Release is not needed in this test.');
    },
    async startRun(input) {
      startRunCalls.push(input);
      return {
        acceptedAt: '2026-04-12T00:00:00.000Z',
        dispatchIdempotencyKey: input.dispatchIdempotencyKey,
        dispatchMode: 'in_process',
        dispatchReference: input.dispatchIdempotencyKey,
        taskEnvelopeId: input.taskEnvelopeId,
        taskId: input.taskId,
      };
    },
  };
}

function createWorkingContextSummaryServiceStub() {
  return {
    async refreshAfterHandsEvent(input: {
      eventSummary: string;
      refreshedAt: string;
      workingContext: { currentObjective: string | null; openQuestions: string[]; summary: string };
    }) {
      return {
        currentObjective: input.workingContext.currentObjective,
        latestHandsStatus: input.eventSummary,
        openQuestions: input.workingContext.openQuestions,
        summary: input.workingContext.summary || input.eventSummary,
        summaryUpdatedAt: input.refreshedAt,
      };
    },
    async refreshAfterTrustedTurn(input: {
      assistantReplyText: string | null;
      completedAt: string;
      trustedMessages: Array<{ body: { text: string } }>;
      workingContext: { latestHandsStatus: string | null; summary: string };
    }) {
      return {
        currentObjective: input.trustedMessages.at(-1)?.body.text ?? null,
        latestHandsStatus: input.workingContext.latestHandsStatus,
        openQuestions: [],
        summary: input.assistantReplyText ?? input.workingContext.summary,
        summaryUpdatedAt: input.completedAt,
      };
    },
  };
}

function createServices(toolName: string, args: Record<string, unknown>) {
  const loggerFactory = createLoggerFactory({
    level: 'debug',
    serviceName: 'api-test',
    sink: () => {},
  });
  const repositoryBundle = createRepositoryBundle();
  const startRunCalls: Array<Record<string, unknown>> = [];
  const taskQueueService = createTaskQueueService({
    handsJobs: createHandsJobStub(startRunCalls),
    logger: loggerFactory.createLogger({ service: 'task_queue_test' }),
    repositories: repositoryBundle.repositories,
  });

  return {
    repositories: repositoryBundle.repositories,
    startRunCalls,
    taskQueueService,
    headRuntimeService: createHeadRuntimeService({
      config: createTestApiConfig(),
      conversationMemoryService: {
        async commitWrites() {
          return { updateIds: [] };
        },
        createWriteCandidate() {
          throw new Error('unused');
        },
        async loadTurnContext() {
          return {
            baselineItems: [],
            binding: null,
            lastSearchId: null,
            promptMemories: [],
            readAllowed: false,
            writeAllowed: false,
          };
        },
        async read() {
          return {
            memories: [],
            searchId: null,
          };
        },
      },
      headRuntime: createToolCallingRuntime(toolName, args),
      logger: loggerFactory.createLogger({ service: 'head_runtime_test' }),
      repositories: repositoryBundle.repositories,
      repositoryConfig: loadRepositoryConfig(),
      scheduleMutationService: {
        async mutate() {
          throw new Error('unused');
        },
      },
      taskQueueService,
      workingContextSummaryService: createWorkingContextSummaryServiceStub(),
    }),
  };
}

describe('task queue runtime integration', () => {
  it('creates durable queued work from create_task tool calls', async () => {
    const services = createServices('create_task', {
      priority: 'high',
      requestedOutcome: 'Confirm the shared-cloud deployment health.',
      taskType: 'follow_up',
    });
    const seeded = await seedTrustedMessageFlow({
      messageId: 'inm_runtime-1',
      messageText: 'Please queue the deployment health check.',
      repositories: services.repositories,
      sequence: 1,
    });

    const result = await services.headRuntimeService.startTurn({
      agentId: seeded.agentId,
      correlation: {
        idempotencyKey: 'idem_runtime-turn-1',
        requestedBy: {
          id: 'telegram-user-1',
          kind: 'telegram',
        },
        traceId: 'trc_runtime-turn-1',
      },
      trigger: {
        kind: 'trusted_messages',
        channelId: seeded.channelId,
        inboundMessageIds: [seeded.inboundMessageId],
        readThroughMessageSequence: 1,
      },
    });

    expect(result.effectSummary.taskRequested).toBe(true);
    expect(result.replyDraft?.body.text).toContain('Queued task request staged');
    expect(services.startRunCalls).toHaveLength(1);

    const openTasks = await services.repositories.tasks.listOpenTasks(seeded.agentId);
    expect(openTasks).toHaveLength(1);
    expect(openTasks[0].value.activeTaskEnvelopeId).toMatch(/^env_/);
    expect(openTasks[0].value.currentRunJournalId).toMatch(/^rjn_/);
    expect(openTasks[0].value.launchState.status).toBe('requested');

    const storedContext = await services.repositories.workingContexts.get(
      seeded.agentId,
      seeded.workingContextId,
    );
    expect(storedContext?.value.openTaskIds).toEqual([openTasks[0].value.id]);
    expect(storedContext?.value.activeTaskId).toBe(openTasks[0].value.id);
  });

  it('merges repeated identical create_task requests into the existing queued task', async () => {
    const services = createServices('create_task', {
      requestedOutcome: 'Confirm the shared-cloud deployment health.',
      taskType: 'follow_up',
    });
    const seededOne = await seedTrustedMessageFlow({
      messageId: 'inm_runtime-merge-1',
      messageText: 'Queue the health check.',
      repositories: services.repositories,
      sequence: 1,
    });
    const seededTwo = await seedTrustedMessageFlow({
      messageId: 'inm_runtime-merge-2',
      messageText: 'Queue the same health check again.',
      repositories: services.repositories,
      sequence: 2,
    });

    await services.headRuntimeService.startTurn({
      agentId: seededOne.agentId,
      correlation: {
        idempotencyKey: 'idem_runtime-merge-turn-1',
        requestedBy: {
          id: 'telegram-user-1',
          kind: 'telegram',
        },
        traceId: 'trc_runtime-merge-turn-1',
      },
      trigger: {
        kind: 'trusted_messages',
        channelId: seededOne.channelId,
        inboundMessageIds: [seededOne.inboundMessageId],
        readThroughMessageSequence: 1,
      },
    });
    const second = await services.headRuntimeService.startTurn({
      agentId: seededTwo.agentId,
      correlation: {
        idempotencyKey: 'idem_runtime-merge-turn-2',
        requestedBy: {
          id: 'telegram-user-1',
          kind: 'telegram',
        },
        traceId: 'trc_runtime-merge-turn-2',
      },
      trigger: {
        kind: 'trusted_messages',
        channelId: seededTwo.channelId,
        inboundMessageIds: [seededTwo.inboundMessageId],
        readThroughMessageSequence: 2,
      },
    });

    const openTasks = await services.repositories.tasks.listOpenTasks(seededTwo.agentId);
    expect(openTasks).toHaveLength(1);
    expect(second.replyDraft?.body.text).toContain('Queued task request staged');
  });

  it('returns queued task and journal summaries through read_status', async () => {
    const services = createServices('read_status', {
      focus: 'tasks',
    });
    const seeded = await seedTrustedMessageFlow({
      messageId: 'inm_runtime-status-1',
      messageText: 'What is happening with my queued work?',
      repositories: services.repositories,
      sequence: 1,
    });

    await services.taskQueueService.enqueueTask({
      agentId: seeded.agentId,
      correlation: createCorrelationMetadata({
        headTurnId: 'hdr_seed-status',
        idempotencyKey: 'idem_seed-status',
        traceId: 'trc_seed-status',
      }),
      dueAt: null,
      externalReferences: [],
      headTurnId: 'hdr_seed-status',
      lane: 'user_requested',
      notes: '',
      priority: 'normal',
      requestedBy: {
        kind: 'user',
        sourceMessageId: seeded.inboundMessageId,
      },
      requestedOutcome: 'Summarize the active deployment check.',
      startRequested: false,
      taskType: 'follow_up',
      workingContextId: seeded.workingContextId,
      workingContextSummary: 'Deployment follow-up context.',
    });

    const result = await services.headRuntimeService.startTurn({
      agentId: seeded.agentId,
      correlation: {
        idempotencyKey: 'idem_runtime-status-turn',
        requestedBy: {
          id: 'telegram-user-1',
          kind: 'telegram',
        },
        traceId: 'trc_runtime-status-turn',
      },
      trigger: {
        kind: 'trusted_messages',
        channelId: seeded.channelId,
        inboundMessageIds: [seeded.inboundMessageId],
        readThroughMessageSequence: 1,
      },
    });

    expect(result.replyDraft?.body.text).toContain('Open tasks: 1');
    expect(result.replyDraft?.body.text).toContain('launch=not_requested');
    expect(result.replyDraft?.body.text).toContain('Summarize the active deployment check.');
  });
});

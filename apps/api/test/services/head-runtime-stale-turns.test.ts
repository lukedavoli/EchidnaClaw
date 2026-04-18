import { loadRepositoryConfig } from '@echidna-claw/config';
import { createApiTestRepositoryBundle, createRuntimeTestHarness } from '@echidna-claw/testing';
import {
  createAgent,
  createChannel,
  createCorrelationMetadata,
  createIdempotencyRecord,
  createInboundMessage,
  createOutboundMessage,
  createWorkingContext,
} from '@echidna-claw/persistence';
import { describe, expect, it } from 'vitest';

import type { FoundryHeadTurnResult, PreparedHeadTurnInput } from '../../src/adapters/foundry/index.js';
import { createTestApiConfig } from '../../src/testing/fixtures/api-config.js';
import { createTrustedChannelIngressDispatcher } from '../../src/services/channel/dispatchers.js';
import { createAuditHistoryService } from '../../src/services/runtime/audit-history-service.js';
import { createHeadRuntimeService } from '../../src/services/runtime/head-runtime-service.js';
import { createTaskQueueService } from '../../src/services/runtime/task-queue-service.js';
import { createUsageAccountingService } from '../../src/services/runtime/usage-accounting-service.js';

function createEmptyEffectSummary() {
  return {
    approvalRequested: false,
    credentialRequested: false,
    memoryOperationRequested: false,
    sandboxRequested: false,
    scheduleChangeRequested: false,
    taskRequested: false,
  };
}

async function appendTrustedInbound(input: {
  channel: Awaited<ReturnType<ReturnType<typeof createRuntimeTestHarness>['suite']['channels']['create']>>;
  correlation: ReturnType<typeof createCorrelationMetadata>;
  messageId: string;
  repositories: ReturnType<typeof createApiTestRepositoryBundle>;
  sequence: number;
  text: string;
  updateKey: string;
}) {
  const message = createInboundMessage({
    agentId: input.channel.value.agentId,
    body: {
      text: input.text,
      artifacts: [],
    },
    channelId: input.channel.value.id,
    correlation: {
      ...input.correlation,
      inboundMessageId: input.messageId,
    },
    id: input.messageId,
    sequence: input.sequence,
    trusted: true,
  });

  return input.repositories.messages.appendInboundMessage({
    channel: {
      ...input.channel.value,
      lastInboundSequence: input.sequence,
      lastExternalMessageId: message.externalMessageId,
      updatedAt: message.receivedAt,
    },
    channelEtag: input.channel.etag,
    idempotencyRecord: createIdempotencyRecord({
      agentId: input.channel.value.agentId,
      correlation: input.correlation,
      id: input.sequence === 1 ? 'idr_runtime1' : 'idr_runtime2',
      key: input.updateKey,
      resultReference: input.messageId,
      scope: 'telegram:webhook',
    }),
    message,
  });
}

describe('Head runtime stale-turn suppression', () => {
  it('does not commit staged task side effects after a newer trusted message supersedes the turn', async () => {
    const harness = createRuntimeTestHarness({
      serviceName: 'head-stale-turns-test',
    });
    const repositories = createApiTestRepositoryBundle(harness.suite);
    const logger = harness.loggerFactory.createLogger({ service: 'head_stale_turns_test' });
    const repositoryConfig = loadRepositoryConfig();
    const startRunCalls: Array<Record<string, unknown>> = [];
    const outboundMessages: string[] = [];
    let releaseFirstTurn!: () => void;
    let markFirstTurnStaged!: () => void;
    const firstTurnStaged = new Promise<void>((resolve) => {
      markFirstTurnStaged = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      releaseFirstTurn = resolve;
    });
    let executionCount = 0;

    const correlation = createCorrelationMetadata({
      idempotencyKey: 'idem_head-stale-seed',
      traceId: 'trc_head-stale-seed',
    });
    const agent = await repositories.agents.create(
      createAgent({
        correlation,
        id: 'agt_runtime',
        primaryChannelId: 'chn_runtime',
        responsibilitiesSummary: 'Exercises stale-turn suppression.',
      }),
    );
    let channel = await repositories.channels.create(
      createChannel({
        agentId: agent.value.id,
        correlation,
        id: 'chn_runtime',
        lastInboundSequence: 0,
        state: 'active',
      }),
    );
    await repositories.workingContexts.create(
      createWorkingContext({
        agentId: agent.value.id,
        correlation,
        id: 'ctx_runtime',
        latestInboundSequence: 0,
        latestProcessedSequence: 0,
        summary: 'Runtime context.',
        summaryUpdatedAt: null,
      }),
    );

    const taskQueueService = createTaskQueueService({
      handsJobs: {
        async releaseForUser() {
          throw new Error('unused');
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
      },
      logger: harness.loggerFactory.createLogger({ service: 'task_queue_test' }),
      repositories,
    });
    const auditHistoryService = createAuditHistoryService({
      logger,
      repositories,
      repositoryConfig,
    });
    const usageAccountingService = createUsageAccountingService({
      logger,
      repositories,
      repositoryConfig,
    });
    const headRuntimeService = createHeadRuntimeService({
      approvalLifecycleService: {
        async recordDecision() {
          throw new Error('unused');
        },
        async requestApproval() {
          throw new Error('unused');
        },
      },
      auditHistoryService,
      config: createTestApiConfig({
        head: {
          debounceWindowMs: 0,
        },
      }),
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
      credentialLifecycleService: {
        async completePendingCaptureFromTrustedInput() {
          return { handled: false };
        },
        async getPendingRequestedCapture() {
          return null;
        },
        async listCredentialSummaries() {
          return [];
        },
        async requestCapture() {
          throw new Error('unused');
        },
        async resolveSandboxBindings() {
          return [];
        },
        async revokeCredential() {
          throw new Error('unused');
        },
        async upsertAgentCredentialFromPlaintext() {
          throw new Error('unused');
        },
      },
      headRuntime: {
        async cancelTurn() {
          return;
        },
        async executeTurn(input: PreparedHeadTurnInput): Promise<FoundryHeadTurnResult> {
          executionCount += 1;

          if (executionCount === 1) {
            const tool = input.enabledTools.find((candidate) => candidate.name === 'create_task');
            if (!tool) {
              throw new Error('Missing create_task tool.');
            }

            const toolResult = await tool.execute({
              priority: 'high',
              requestedOutcome: 'Confirm the shared-cloud deployment health.',
              taskType: 'follow_up',
            });
            markFirstTurnStaged();
            await releasePromise;

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
              usage: null,
            };
          }

          return {
            assistantText: 'Second trusted message wins.',
            completionKind: 'reply',
            conversationCursor: `test-conversation:${input.headTurnId}`,
            deferredDirectives: [],
            effectSummary: createEmptyEffectSummary(),
            providerConversationId: `test-conversation:${input.headTurnId}`,
            providerRunId: `test-run:${input.headTurnId}`,
            usage: null,
          };
        },
      },
      logger,
      repositories,
      repositoryConfig,
      scheduleMutationService: {
        async mutate() {
          throw new Error('unused');
        },
      },
      taskQueueService,
      usageAccountingService,
      workingContextSummaryService: {
        async refreshAfterHandsEvent() {
          return {
            currentObjective: null,
            latestHandsStatus: null,
            openQuestions: [],
            summary: 'Hands summary',
            summaryUpdatedAt: '2026-04-12T00:00:00.000Z',
          };
        },
        async refreshAfterTrustedTurn(input) {
          return {
            currentObjective: input.trustedMessages.at(-1)?.body.text ?? null,
            latestHandsStatus: null,
            openQuestions: [],
            summary: input.assistantReplyText ?? 'Second trusted message wins.',
            summaryUpdatedAt: input.completedAt,
            usage: null,
          };
        },
      },
    });
    const dispatcher = createTrustedChannelIngressDispatcher({
      config: createTestApiConfig({
        head: {
          debounceWindowMs: 0,
        },
      }),
      headRuntimeService,
      logger,
      outboundMessagingService: {
        async sendMessage(input) {
          outboundMessages.push(input.text);
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
      repositories,
    });

    channel = (
      await appendTrustedInbound({
        channel,
        correlation,
        messageId: 'inm_runtime-1',
        repositories,
        sequence: 1,
        text: 'Please queue the deployment health check.',
        updateKey: 'upd_runtime-1',
      })
    ).channel;

    const firstDispatch = dispatcher.dispatchTrustedInboundMessage({
      agentId: agent.value.id,
      channelId: channel.value.id,
      correlation: {
        ...correlation,
        idempotencyKey: 'idem_dispatch-1',
        requestedBy: {
          id: 'telegram-user-1',
          kind: 'telegram',
        },
        traceId: 'trc_dispatch-1',
      },
      inboundMessageId: 'inm_runtime-1',
      readThroughMessageSequence: 1,
    });

    await firstTurnStaged;

    channel = (
      await appendTrustedInbound({
        channel,
        correlation,
        messageId: 'inm_runtime-2',
        repositories,
        sequence: 2,
        text: 'Ignore the queued work and answer this instead.',
        updateKey: 'upd_runtime-2',
      })
    ).channel;

    const secondDispatch = dispatcher.dispatchTrustedInboundMessage({
      agentId: agent.value.id,
      channelId: channel.value.id,
      correlation: {
        ...correlation,
        idempotencyKey: 'idem_dispatch-2',
        requestedBy: {
          id: 'telegram-user-1',
          kind: 'telegram',
        },
        traceId: 'trc_dispatch-2',
      },
      inboundMessageId: 'inm_runtime-2',
      readThroughMessageSequence: 2,
    });

    releaseFirstTurn();
    await Promise.all([firstDispatch, secondDispatch]);

    const openTasks = await repositories.tasks.listOpenTasks(agent.value.id);
    expect(openTasks).toHaveLength(0);
    expect(startRunCalls).toHaveLength(0);
    expect(outboundMessages).toEqual(['Second trusted message wins.']);
  });
});

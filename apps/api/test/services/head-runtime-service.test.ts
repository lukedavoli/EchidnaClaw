import { loadRepositoryConfig } from '@echidna-claw/config';
import { createLoggerFactory } from '@echidna-claw/observability';
import {
  createAgent,
  createChannel,
  createCorrelationMetadata,
  createIdempotencyRecord,
  createInMemoryRepositorySuite,
  createInboundMessage,
} from '@echidna-claw/persistence';
import { describe, expect, it } from 'vitest';

import { createHeadRuntimeService } from '../../src/services/runtime/head-runtime-service.js';

async function appendTrustedInbound(input: {
  agentId: string;
  channelId: string;
  channelRecord: Awaited<ReturnType<ReturnType<typeof createInMemoryRepositorySuite>['channels']['create']>>;
  correlation: ReturnType<typeof createCorrelationMetadata>;
  messageId: string;
  repositories: ReturnType<typeof createInMemoryRepositorySuite>;
  sequence: number;
  text: string;
  updateKey: string;
}) {
  const message = createInboundMessage({
    id: input.messageId,
    agentId: input.agentId,
    channelId: input.channelId,
    correlation: {
      ...input.correlation,
      inboundMessageId: input.messageId,
      channelUpdateKey: input.updateKey,
    },
    sequence: input.sequence,
    externalMessageId: `telegram-message-${input.updateKey}`,
    externalUpdateId: `telegram-update-${input.updateKey}`,
    body: {
      text: input.text,
      artifacts: [],
    },
  });

  return input.repositories.messages.appendInboundMessage({
    channel: {
      ...input.channelRecord.value,
      correlation: input.correlation,
      lastInboundSequence: input.sequence,
      lastInboundReceivedAt: message.receivedAt,
      lastInboundExternalMessageId: message.externalMessageId,
      lastExternalMessageId: message.externalMessageId,
      updatedAt: message.receivedAt,
    },
    channelEtag: input.channelRecord.etag,
    idempotencyRecord: createIdempotencyRecord({
      id: `idr_${input.updateKey.slice(4)}`,
      agentId: input.agentId,
      correlation: {
        ...input.correlation,
        inboundMessageId: input.messageId,
        channelUpdateKey: input.updateKey,
      },
      key: input.updateKey,
      resultReference: input.messageId,
      scope: 'telegram:webhook',
    }),
    message,
  });
}

async function executeTrustedTurn(input: {
  agentHeadModel: string;
  runtimeMode: 'local-minimal' | 'shared-cloud';
}): Promise<string | undefined> {
  const repositories = createInMemoryRepositorySuite();
  const repositoryConfig = loadRepositoryConfig();
  const logger = createLoggerFactory({
    level: 'info',
    serviceName: 'head-runtime-service-test',
  }).createLogger();
  const seenModels: Array<string | undefined> = [];
  const unique = `${input.runtimeMode.replace('-', '')}${input.agentHeadModel.replace(/[^a-z0-9]/gi, '').toLowerCase()}`;
  const agentId = `agt_${unique}`;
  const channelId = `chn_${unique}`;
  const correlation = createCorrelationMetadata({
    analyticsKey: `anl_${unique}`,
    channelUpdateKey: `upd_${unique}`,
    headTurnId: undefined,
    idempotencyKey: `idem_${unique}`,
    inboundMessageId: undefined,
    requestedBy: {
      kind: 'telegram',
      id: 'telegram-user-test',
      displayName: 'Head Runtime Test User',
    },
    traceId: `trc_${unique}`,
  });

  const service = createHeadRuntimeService({
    config: {
      runtimeMode: input.runtimeMode,
    } as never,
    headRuntime: {
      async cancelTurn(): Promise<void> {},
      async executeTurn(turn) {
        seenModels.push(turn.model);

        return {
          assistantText: 'Ready.',
          completionKind: 'reply',
          conversationCursor: 'conv_test',
          effectSummary: {
            approvalRequested: false,
            memoryOperationRequested: false,
            sandboxRequested: false,
            scheduleChangeRequested: false,
            taskRequested: false,
          },
          providerConversationId: 'conv_test',
          providerRunId: 'run_test',
        };
      },
    },
    logger,
    repositories: {
      agents: repositories.agents,
      agentRegistry: repositories.agentRegistry,
      analytics: {
        async getOverview() {
          throw new Error('unused');
        },
      },
      approvals: {
        async getState() {
          throw new Error('unused');
        },
      },
      channels: repositories.channels,
      credentials: repositories.credentials,
      execution: repositories.execution,
      messages: repositories.messages,
      runJournals: repositories.runJournals,
      schedules: repositories.schedules,
      tasks: repositories.tasks,
      workingContexts: repositories.workingContexts,
    },
    repositoryConfig,
    scheduleMutationService: {
      async mutate() {
        throw new Error('unused');
      },
    },
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
      async requestQueuedTaskStart() {
        throw new Error('unused');
      },
    },
    workingContextSummaryService: {
      async refreshAfterHandsEvent() {
        return {
          currentObjective: null,
          latestHandsStatus: null,
          openQuestions: [],
          summary: 'Hands summary',
          summaryUpdatedAt: '2026-04-14T00:00:00.000Z',
        };
      },
      async refreshAfterTrustedTurn(inputSummary) {
        return {
          currentObjective: inputSummary.trustedMessages.at(-1)?.body.text ?? null,
          latestHandsStatus: null,
          openQuestions: [],
          summary: inputSummary.assistantReplyText ?? 'Ready.',
          summaryUpdatedAt: inputSummary.completedAt,
        };
      },
    },
  });

  await repositories.agents.create(
    createAgent({
      id: agentId,
      primaryChannelId: channelId,
      correlation,
      headModel: input.agentHeadModel,
    }),
  );
  const channelRecord = await repositories.channels.create(
    createChannel({
      id: channelId,
      agentId,
      correlation,
      trustedExternalUserId: 'telegram-user-test',
    }),
  );

  await appendTrustedInbound({
    agentId,
    channelId,
    channelRecord,
    correlation,
    messageId: `inm_${unique}`,
    repositories,
    sequence: 1,
    text: 'Reply briefly that you are ready.',
    updateKey: `upd_${unique}1`,
  });

  const result = await service.startTurn({
    agentId,
    correlation: {
      ...correlation,
      idempotencyKey: `idem_${unique}1`,
    },
    trigger: {
      kind: 'trusted_messages',
      channelId,
      inboundMessageIds: [`inm_${unique}`],
      readThroughMessageSequence: 1,
    },
  });

  expect(result.status).toBe('replied');
  expect(seenModels).toHaveLength(1);

  return seenModels[0];
}

describe('createHeadRuntimeService model selection', () => {
  it('passes the stored model through in local-minimal mode', async () => {
    await expect(
      executeTrustedTurn({
        agentHeadModel: 'gpt-5.4-mini',
        runtimeMode: 'local-minimal',
      }),
    ).resolves.toBe('gpt-5.4-mini');
  });

  it('falls back to the configured deployment in shared-cloud mode for model aliases', async () => {
    await expect(
      executeTrustedTurn({
        agentHeadModel: 'gpt-5.4-mini',
        runtimeMode: 'shared-cloud',
      }),
    ).resolves.toBeUndefined();
  });
});

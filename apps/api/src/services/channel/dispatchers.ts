import type { WorkingContext } from '@echidna-claw/contracts';
import type { Logger } from '@echidna-claw/observability';
import { applyTrustedIngress, shouldSupersedeTurn } from '@echidna-claw/domain';
import { DuplicateRecordError, OptimisticConcurrencyError, type StoredRecord } from '@echidna-claw/persistence';

import type { ApiRuntimeConfig } from '../../config/api-runtime-config.js';
import type { RepositoryBundle } from '../../adapters/repositories/index.js';
import { ConflictError } from '../../http/errors.js';
import type {
  ApprovalCallbackService,
  OutboundMessagingService,
  TrustedChannelIngressDispatcher,
} from './contracts.js';
import type {
  ChannelActionResponse,
  HeadService,
  TrustedChannelIngressDispatchRequest,
} from '@echidna-claw/contracts';

const DISPATCHER_RETRY_LIMIT = 3;

function now(): string {
  return new Date().toISOString();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function createWorkingContextRecord(input: {
  agentId: string;
  correlation: TrustedChannelIngressDispatchRequest['correlation'];
  createdAt: string;
}): WorkingContext {
  return {
    id: `ctx_${input.agentId.slice(4)}-main`,
    recordType: 'working_context',
    schemaVersion: 1,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    correlation: input.correlation,
    agentId: input.agentId,
    latestInboundSequence: 0,
    latestProcessedSequence: 0,
    activeHeadTurnId: null,
    activeHeadTurnStartedAt: null,
    activeHeadTurnReadThroughSequence: null,
    pendingSupersededBySequence: null,
    debounceUntil: null,
    pendingDebounceSequence: null,
    episodeLocalDate: null,
    episodeTurnCount: 0,
    activeTaskId: null,
    summary: '',
    summaryUpdatedAt: null,
    currentObjective: null,
    latestHandsStatus: null,
    openQuestions: [],
    conversationCursor: undefined,
    openTaskIds: [],
    pendingApprovalIds: [],
  };
}

async function getOrCreateWorkingContext(options: {
  agentId: string;
  correlation: TrustedChannelIngressDispatchRequest['correlation'];
  createdAt: string;
  repositories: RepositoryBundle;
}): Promise<StoredRecord<WorkingContext>> {
  const existing = await options.repositories.workingContexts.getByAgent(options.agentId);
  if (existing) {
    return existing;
  }

  try {
    return await options.repositories.workingContexts.create(
      createWorkingContextRecord({
        agentId: options.agentId,
        correlation: options.correlation,
        createdAt: options.createdAt,
      }),
    );
  } catch (error) {
    if (!(error instanceof DuplicateRecordError)) {
      throw error;
    }

    const replay = await options.repositories.workingContexts.getByAgent(options.agentId);
    if (!replay) {
      throw error;
    }

    return replay;
  }
}

export function createTrustedChannelIngressDispatcher(options: {
  config: ApiRuntimeConfig;
  headRuntimeService: HeadService;
  logger: Logger;
  outboundMessagingService: OutboundMessagingService;
  repositories: RepositoryBundle;
}): TrustedChannelIngressDispatcher {
  return {
    async dispatchTrustedInboundMessage(
      input: TrustedChannelIngressDispatchRequest,
    ): Promise<void> {
      options.logger.info('trusted_channel_ingress.dispatch', {
        agentId: input.agentId,
        channelId: input.channelId,
        inboundMessageId: input.inboundMessageId,
        readThroughMessageSequence: input.readThroughMessageSequence,
      });

      let storedWorkingContext: StoredRecord<WorkingContext> | null = null;
      for (let attempt = 0; attempt < DISPATCHER_RETRY_LIMIT; attempt += 1) {
        const currentWorkingContext = await getOrCreateWorkingContext({
          agentId: input.agentId,
          correlation: input.correlation,
          createdAt: now(),
          repositories: options.repositories,
        });

        try {
          storedWorkingContext = await options.repositories.workingContexts.replace(
            applyTrustedIngress({
              debounceWindowMs: options.config.head.debounceWindowMs,
              observedAt: now(),
              readThroughSequence: input.readThroughMessageSequence,
              workingContext: currentWorkingContext.value,
            }),
            currentWorkingContext.etag,
          );
          break;
        } catch (error) {
          if (error instanceof OptimisticConcurrencyError) {
            continue;
          }

          throw error;
        }
      }

      if (!storedWorkingContext) {
        throw new ConflictError(
          `Unable to record trusted ingress for agent ${input.agentId}.`,
        );
      }

      if (
        storedWorkingContext.value.activeHeadTurnId &&
        shouldSupersedeTurn({
          activeReadThroughSequence: storedWorkingContext.value.activeHeadTurnReadThroughSequence,
          latestInboundSequence: storedWorkingContext.value.latestInboundSequence,
        })
      ) {
        try {
          await options.headRuntimeService.supersedeTurn({
            correlation: input.correlation,
            headTurnId: storedWorkingContext.value.activeHeadTurnId,
            supersededBySequence: storedWorkingContext.value.latestInboundSequence,
          });
        } catch (error) {
          options.logger.warn('trusted_channel_ingress.supersede_failed', {
            agentId: input.agentId,
            headTurnId: storedWorkingContext.value.activeHeadTurnId,
            message: error instanceof Error ? error.message : 'Unknown supersede failure.',
          });
        }
      }

      if (options.config.head.debounceWindowMs > 0) {
        await delay(options.config.head.debounceWindowMs);
      }

      const latestWorkingContext = await getOrCreateWorkingContext({
        agentId: input.agentId,
        correlation: input.correlation,
        createdAt: now(),
        repositories: options.repositories,
      });
      const targetSequence = latestWorkingContext.value.latestInboundSequence;

      if (latestWorkingContext.value.latestProcessedSequence >= targetSequence) {
        return;
      }

      if (
        latestWorkingContext.value.activeHeadTurnId != null &&
        latestWorkingContext.value.activeHeadTurnReadThroughSequence != null &&
        latestWorkingContext.value.activeHeadTurnReadThroughSequence >= targetSequence
      ) {
        return;
      }

      const trustedMessages =
        await options.repositories.messages.listTrustedInboundMessagesBySequenceRange({
          agentId: input.agentId,
          channelId: input.channelId,
          fromSequence: latestWorkingContext.value.latestProcessedSequence + 1,
          throughSequence: targetSequence,
        });

      if (trustedMessages.length === 0) {
        options.logger.warn('trusted_channel_ingress.empty_window', {
          agentId: input.agentId,
          channelId: input.channelId,
          fromSequence: latestWorkingContext.value.latestProcessedSequence + 1,
          throughSequence: targetSequence,
        });
        return;
      }

      let turnResult;
      try {
        turnResult = await options.headRuntimeService.startTurn({
          agentId: input.agentId,
          correlation: input.correlation,
          trigger: {
            kind: 'trusted_messages',
            channelId: input.channelId,
            inboundMessageIds: trustedMessages.map((message) => message.value.id),
            readThroughMessageSequence: targetSequence,
          },
        });
      } catch (error) {
        if (error instanceof ConflictError || error instanceof OptimisticConcurrencyError) {
          options.logger.info('trusted_channel_ingress.coalesced_elsewhere', {
            agentId: input.agentId,
            channelId: input.channelId,
            throughSequence: targetSequence,
          });
          return;
        }

        throw error;
      }

      if (turnResult.status === 'superseded') {
        options.logger.info('trusted_channel_ingress.superseded', {
          agentId: input.agentId,
          channelId: input.channelId,
          headTurnId: turnResult.headTurn.id,
          throughSequence: targetSequence,
        });
        return;
      }

      if (turnResult.status !== 'replied' || !turnResult.replyDraft) {
        return;
      }

      await options.outboundMessagingService.sendMessage({
        actions: [],
        agentId: turnResult.replyDraft.agentId,
        channelId: turnResult.replyDraft.channelId,
        correlation: {
          ...input.correlation,
          idempotencyKey: `${input.correlation.idempotencyKey}-reply`,
        },
        ...(turnResult.replyDraft.inReplyToInboundMessageId
          ? {
              inReplyToInboundMessageId: turnResult.replyDraft.inReplyToInboundMessageId,
            }
          : {}),
        text: turnResult.replyDraft.body.text,
      });
    },
  };
}

export function createApprovalActionDispatcher(options: {
  logger: Logger;
}): ApprovalCallbackService {
  return {
    async handleActionResponse(input: ChannelActionResponse): Promise<void> {
      switch (input.kind) {
        case 'approval_decision':
          options.logger.info('approval_action.dispatch', {
            agentId: input.agentId,
            approvalId: input.approvalId,
            channelId: input.channelId,
            decision: input.decision,
            inboundMessageId: input.inboundMessageId,
          });
          return;
        default:
          options.logger.warn('approval_action.unsupported', {
            channelId: input.channelId,
            kind: (input as { kind?: string }).kind ?? 'unknown',
          });
      }
    },
  };
}

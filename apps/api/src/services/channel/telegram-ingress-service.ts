import { randomUUID } from 'node:crypto';

import type {
  AgentId,
  Channel,
  ChannelActionResponse,
  CorrelationMetadata,
  InboundMessage,
  TelegramMessageSender,
} from '@echidna-claw/contracts';
import {
  approvalDecisionChannelActionResponseSchema,
  trustedChannelIngressDispatchRequestSchema,
} from '@echidna-claw/contracts';
import {
  createDeterministicIdempotencyRecordId,
  createDeterministicInboundMessageId,
  createInboundMessageIdempotencyKey,
  createTelegramChannelUpdateKey,
  decodeTelegramCallbackData,
} from '@echidna-claw/domain';
import {
  OptimisticConcurrencyError,
} from '@echidna-claw/persistence';
import {
  getRequestContext,
  updateRequestContext,
  type Logger,
} from '@echidna-claw/observability';

import type { RepositoryBundle } from '../../adapters/repositories/index.js';
import type { TelegramBotApiAdapter } from '../../adapters/telegram/index.js';
import type {
  ApprovalCallbackService,
  TelegramIngressService,
  TrustedChannelIngressDispatcher,
} from './contracts.js';
import type { CredentialLifecycleService } from '../runtime/credential-lifecycle-service.js';
import {
  normalizeTelegramWebhookUpdate,
  type NormalizedTelegramUpdate,
} from './telegram-normalization.js';
 

const SCHEMA_VERSION = 1 as const;
const INBOUND_IDEMPOTENCY_SCOPE = 'telegram:webhook';
const INBOUND_REPLAY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INBOUND_APPEND_RETRY_LIMIT = 3;

function getTraceId(): string {
  return getRequestContext()?.traceId ?? `trc_${randomUUID().replace(/-/g, '').toLowerCase()}`;
}

function buildCorrelation(input: {
  agentId: AgentId;
  inboundMessageId: InboundMessage['id'];
  normalized: NormalizedTelegramUpdate;
  sender?: TelegramMessageSender;
}): CorrelationMetadata {
  const traceId = getTraceId();

  return {
    traceId,
    idempotencyKey: createInboundMessageIdempotencyKey(input.agentId, input.normalized.externalUpdateId),
    channelUpdateKey: createTelegramChannelUpdateKey(
      input.agentId,
      input.normalized.externalUpdateId,
    ),
    inboundMessageId: input.inboundMessageId,
    ...(input.normalized.externalChatId
      ? {
          externalMessage: {
            provider: 'telegram',
            externalChatId: input.normalized.externalChatId,
            ...(input.normalized.externalMessageId
              ? { externalMessageId: input.normalized.externalMessageId }
              : {}),
            externalUpdateId: input.normalized.externalUpdateId,
          },
        }
      : {}),
    ...(input.sender
      ? {
          requestedBy: {
            id: input.sender.externalUserId,
            kind: 'telegram',
            ...(input.sender.displayName ? { displayName: input.sender.displayName } : {}),
          },
        }
      : {}),
  };
}

function evaluateNormalizedUpdate(input: {
  channel: Channel;
  normalized: NormalizedTelegramUpdate;
}): {
  bindTrustedIdentity: boolean;
  kind: InboundMessage['kind'];
  trusted: boolean;
  unsupportedType?: string;
} {
  let kind = input.normalized.kind;
  let trusted = input.normalized.kind !== 'unsupported';
  let unsupportedType = input.normalized.unsupportedType;

  if (input.normalized.chatType !== 'private') {
    kind = 'unsupported';
    trusted = false;
    unsupportedType = unsupportedType ?? `chat:${input.normalized.chatType}`;
  }

  if (!input.normalized.sender || input.normalized.senderIsBot) {
    kind = 'unsupported';
    trusted = false;
    unsupportedType = unsupportedType ?? (input.normalized.senderIsBot ? 'sender:bot' : 'sender:missing');
  }

  if (
    trusted &&
    input.channel.externalChatId &&
    input.normalized.externalChatId &&
    input.channel.externalChatId !== input.normalized.externalChatId
  ) {
    trusted = false;
    unsupportedType = 'trust:chat_mismatch';
  }

  if (
    trusted &&
    input.channel.trustedExternalUserId &&
    input.normalized.sender &&
    input.channel.trustedExternalUserId !== input.normalized.sender.externalUserId
  ) {
    trusted = false;
    unsupportedType = 'trust:user_mismatch';
  }

  return {
    bindTrustedIdentity:
      trusted && input.normalized.externalChatId != null && input.normalized.sender != null,
    kind,
    trusted,
    ...(unsupportedType ? { unsupportedType } : {}),
  };
}

function buildUpdatedChannel(input: {
  bindTrustedIdentity: boolean;
  channel: Channel;
  normalized: NormalizedTelegramUpdate;
  receivedAt: string;
  sequence: number;
}): Channel {
  const trustedExternalDisplayName =
    input.normalized.sender?.displayName ?? input.channel.trustedExternalDisplayName;
  const trustedExternalUserHandle =
    input.normalized.sender?.externalUserHandle ?? input.channel.trustedExternalUserHandle;
  const lastInboundExternalMessageId =
    input.normalized.externalMessageId ?? input.channel.lastInboundExternalMessageId;
  const legacyLastExternalMessageId =
    input.normalized.externalMessageId ?? input.channel.lastExternalMessageId;

  return {
    ...input.channel,
    updatedAt: input.receivedAt,
    ...(input.bindTrustedIdentity && input.normalized.externalChatId
      ? { externalChatId: input.channel.externalChatId ?? input.normalized.externalChatId }
      : {}),
    ...(input.bindTrustedIdentity && input.normalized.sender
      ? {
          trustedExternalUserId:
            input.channel.trustedExternalUserId ?? input.normalized.sender.externalUserId,
          ...(trustedExternalDisplayName
            ? { trustedExternalDisplayName }
            : {}),
          ...(trustedExternalUserHandle
            ? { trustedExternalUserHandle }
            : {}),
        }
      : {}),
    lastInboundSequence: input.sequence,
    lastInboundReceivedAt: input.receivedAt,
    ...(lastInboundExternalMessageId ? { lastInboundExternalMessageId } : {}),
    ...(legacyLastExternalMessageId ? { lastExternalMessageId: legacyLastExternalMessageId } : {}),
  };
}

function buildInboundMessage(input: {
  agentId: InboundMessage['agentId'];
  bodyText?: string;
  channelId: InboundMessage['channelId'];
  correlation: CorrelationMetadata;
  inboundMessageId: InboundMessage['id'];
  normalized: NormalizedTelegramUpdate;
  receivedAt: string;
  sequence: number;
  redacted?: boolean;
  sensitiveInputKind?: InboundMessage['sensitiveInputKind'];
  trusted: boolean;
  kind: InboundMessage['kind'];
  unsupportedType?: string;
}): InboundMessage {
  return {
    id: input.inboundMessageId,
    recordType: 'inbound_message',
    schemaVersion: SCHEMA_VERSION,
    createdAt: input.receivedAt,
    updatedAt: input.receivedAt,
    correlation: input.correlation,
    agentId: input.agentId,
    channelId: input.channelId,
    sequence: input.sequence,
    kind: input.kind,
    receivedAt: input.receivedAt,
    ...(input.normalized.externalChatId
      ? { externalChatId: input.normalized.externalChatId }
      : {}),
    ...(input.normalized.externalMessageId
      ? { externalMessageId: input.normalized.externalMessageId }
      : {}),
    externalUpdateId: input.normalized.externalUpdateId,
    trusted: input.trusted,
    ...(input.normalized.sender ? { sender: input.normalized.sender } : {}),
    ...(input.normalized.callbackData ? { callbackData: input.normalized.callbackData } : {}),
    ...(input.unsupportedType ? { unsupportedType: input.unsupportedType } : {}),
    redacted: input.redacted ?? false,
    sensitiveInputKind: input.sensitiveInputKind ?? null,
    body: {
      text: input.bodyText ?? input.normalized.text,
      artifacts: [],
    },
  };
}

async function acknowledgeCallbackQuery(options: {
  callbackQueryId: string;
  channel: Channel;
  logger: Logger;
  repositories: RepositoryBundle;
  telegramBotApi: TelegramBotApiAdapter;
  text?: string;
}): Promise<void> {
  if (!options.channel.credentialId) {
    return;
  }

  let botToken: string | null;
  try {
    botToken = await options.repositories.credentials.decryptCredential(
      options.channel.agentId,
      options.channel.credentialId,
    );
  } catch (error) {
    options.logger.warn('telegram_ingress.callback_ack_credential_unavailable', {
      callbackQueryId: options.callbackQueryId,
      channelId: options.channel.id,
      credentialId: options.channel.credentialId,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
    return;
  }
  if (!botToken) {
    return;
  }

  try {
    await options.telegramBotApi.answerCallbackQuery({
      botToken,
      callbackQueryId: options.callbackQueryId,
      ...(options.text ? { text: options.text } : {}),
    });
  } catch (error) {
    options.logger.warn('telegram_ingress.callback_ack_failed', {
      callbackQueryId: options.callbackQueryId,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export function createTelegramIngressService(options: {
  approvalCallbackService: ApprovalCallbackService;
  credentialLifecycleService: CredentialLifecycleService;
  logger: Logger;
  repositories: RepositoryBundle;
  telegramBotApi: TelegramBotApiAdapter;
  trustedChannelIngressDispatcher: TrustedChannelIngressDispatcher;
}): TelegramIngressService {
  return {
    async handleWebhook(input): Promise<void> {
      const normalized = normalizeTelegramWebhookUpdate(input.update);
      const resolvedChannel = await options.repositories.channels.getById(input.channelId);
      if (!resolvedChannel || resolvedChannel.value.provider !== 'telegram') {
        options.logger.warn('telegram_ingress.channel_not_found', {
          channelId: input.channelId,
          updateId: input.update.update_id,
        });
        return;
      }

      const agent = await options.repositories.agents.get(resolvedChannel.value.agentId);
      if (!agent) {
        options.logger.warn('telegram_ingress.agent_not_found', {
          agentId: resolvedChannel.value.agentId,
          channelId: input.channelId,
        });
        return;
      }

      if (
        agent.value.lifecycleState !== 'active' ||
        agent.value.provisioningState !== 'active' ||
        resolvedChannel.value.state !== 'active'
      ) {
        options.logger.info('telegram_ingress.channel_inactive', {
          agentId: agent.value.id,
          channelId: input.channelId,
          channelState: resolvedChannel.value.state,
          provisioningState: agent.value.provisioningState,
        });
        return;
      }

      const inboundMessageId = createDeterministicInboundMessageId(
        agent.value.id,
        normalized.externalUpdateId,
      );
      const correlation = buildCorrelation({
        agentId: agent.value.id,
        inboundMessageId,
        normalized,
        ...(normalized.sender ? { sender: normalized.sender } : {}),
      });
      updateRequestContext({
        agentId: agent.value.id,
        correlation,
      });

      let storedChannel = resolvedChannel;
      let appendResult:
        | Awaited<ReturnType<RepositoryBundle['messages']['appendInboundMessage']>>
        | undefined;

      for (let attempt = 0; attempt < INBOUND_APPEND_RETRY_LIMIT; attempt += 1) {
        const receivedAt = new Date().toISOString();
        const evaluation = evaluateNormalizedUpdate({
          channel: storedChannel.value,
          normalized,
        });
        const pendingCredentialCapture =
          evaluation.trusted && normalized.kind === 'text'
            ? await options.credentialLifecycleService.getPendingRequestedCapture(agent.value.id)
            : null;
        const secureCredentialCapture =
          pendingCredentialCapture?.requestChannelId === storedChannel.value.id
            ? pendingCredentialCapture
            : null;
        const sequence = storedChannel.value.lastInboundSequence + 1;
        const message = buildInboundMessage({
          agentId: agent.value.id,
          ...(secureCredentialCapture
            ? {
                bodyText: '[credential input redacted]',
                redacted: true,
                sensitiveInputKind: 'credential' as const,
              }
            : {}),
          channelId: storedChannel.value.id,
          correlation,
          inboundMessageId,
          normalized,
          receivedAt,
          sequence,
          trusted: evaluation.trusted,
          kind: evaluation.kind,
          ...(evaluation.unsupportedType ? { unsupportedType: evaluation.unsupportedType } : {}),
        });

        try {
          appendResult = await options.repositories.messages.appendInboundMessage({
            channel: buildUpdatedChannel({
              bindTrustedIdentity: evaluation.bindTrustedIdentity,
              channel: storedChannel.value,
              normalized,
              receivedAt,
              sequence,
            }),
            channelEtag: storedChannel.etag,
            idempotencyRecord: {
              id: createDeterministicIdempotencyRecordId(
                agent.value.id,
                INBOUND_IDEMPOTENCY_SCOPE,
                correlation.idempotencyKey,
              ),
              recordType: 'idempotency_record',
              schemaVersion: SCHEMA_VERSION,
              createdAt: receivedAt,
              updatedAt: receivedAt,
              correlation,
              agentId: agent.value.id,
              scope: INBOUND_IDEMPOTENCY_SCOPE,
              key: correlation.idempotencyKey,
              status: 'completed',
              resultReference: inboundMessageId,
              expiresAt: new Date(Date.parse(receivedAt) + INBOUND_REPLAY_TTL_MS).toISOString(),
            },
            message,
          });
          break;
        } catch (error) {
          if (!(error instanceof OptimisticConcurrencyError) || attempt === INBOUND_APPEND_RETRY_LIMIT - 1) {
            throw error;
          }

          const reloadedChannel = await options.repositories.channels.get(agent.value.id, input.channelId);
          if (!reloadedChannel) {
            throw error;
          }

          storedChannel = reloadedChannel;
        }
      }

      if (!appendResult) {
        throw new Error('Telegram ingress append did not produce a stored result.');
      }

      if (appendResult.replayed) {
        options.logger.info('telegram_ingress.replayed', {
          inboundMessageId,
          updateId: normalized.externalUpdateId,
        });

        if (normalized.callbackQueryId) {
          await acknowledgeCallbackQuery({
            callbackQueryId: normalized.callbackQueryId,
            channel: appendResult.channel.value,
            logger: options.logger,
            repositories: options.repositories,
            telegramBotApi: options.telegramBotApi,
            text: 'Already received.',
          });
        }
        return;
      }

      if (appendResult.message.value.kind === 'unsupported' || !appendResult.message.value.trusted) {
        options.logger.info('telegram_ingress.dropped', {
          inboundMessageId,
          trusted: appendResult.message.value.trusted,
          unsupportedType: appendResult.message.value.unsupportedType,
        });

        if (normalized.callbackQueryId) {
          await acknowledgeCallbackQuery({
            callbackQueryId: normalized.callbackQueryId,
            channel: appendResult.channel.value,
            logger: options.logger,
            repositories: options.repositories,
            telegramBotApi: options.telegramBotApi,
            text:
              appendResult.message.value.kind === 'unsupported'
                ? 'Unsupported action.'
                : 'This action is not trusted for this agent.',
          });
        }
        return;
      }

      if (appendResult.message.value.kind === 'callback_query') {
        const decodedAction = normalized.callbackData
          ? decodeTelegramCallbackData(normalized.callbackData)
          : null;

        if (!decodedAction) {
          await acknowledgeCallbackQuery({
            callbackQueryId: normalized.callbackQueryId!,
            channel: appendResult.channel.value,
            logger: options.logger,
            repositories: options.repositories,
            telegramBotApi: options.telegramBotApi,
            text: 'Unsupported action.',
          });
          return;
        }

        const actionResponse = approvalDecisionChannelActionResponseSchema.parse({
          ...decodedAction,
          agentId: agent.value.id,
          channelId: appendResult.channel.value.id,
          inboundMessageId,
          correlation,
        }) as ChannelActionResponse;

        await options.approvalCallbackService.handleActionResponse(actionResponse);
        await acknowledgeCallbackQuery({
          callbackQueryId: normalized.callbackQueryId!,
          channel: appendResult.channel.value,
          logger: options.logger,
          repositories: options.repositories,
          telegramBotApi: options.telegramBotApi,
          text: 'Decision recorded.',
        });
        return;
      }

      if (appendResult.message.value.redacted && appendResult.message.value.sensitiveInputKind === 'credential') {
        await options.credentialLifecycleService.completePendingCaptureFromTrustedInput({
          agentId: agent.value.id,
          channelId: appendResult.channel.value.id,
          correlation,
          inboundMessageId,
          plaintext: normalized.text,
        });
        return;
      }

      await options.trustedChannelIngressDispatcher.dispatchTrustedInboundMessage(
        trustedChannelIngressDispatchRequestSchema.parse({
          agentId: agent.value.id,
          channelId: appendResult.channel.value.id,
          inboundMessageId,
          readThroughMessageSequence: appendResult.message.value.sequence,
          correlation,
        }),
      );
    },
  };
}

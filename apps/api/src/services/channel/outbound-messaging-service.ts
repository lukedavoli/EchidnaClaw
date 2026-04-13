import type { OutboundMessage, SendChannelMessageRequest } from '@echidna-claw/contracts';
import { createDeterministicOutboundMessageId } from '@echidna-claw/domain';
import {
  DuplicateRecordError,
  OptimisticConcurrencyError,
  type StoredRecord,
} from '@echidna-claw/persistence';
import type { Logger } from '@echidna-claw/observability';

import type { RepositoryBundle } from '../../adapters/repositories/index.js';
import {
  TelegramBotApiError,
  type TelegramBotApiAdapter,
} from '../../adapters/telegram/index.js';
import type { OutboundMessagingService } from './contracts.js';

const SCHEMA_VERSION = 1 as const;
const OUTBOUND_CHANNEL_SAVE_RETRY_LIMIT = 3;

function buildQueuedOutboundMessage(input: {
  outboundMessageId: OutboundMessage['id'];
  requestedAt: string;
  request: SendChannelMessageRequest;
}): OutboundMessage {
  return {
    id: input.outboundMessageId,
    recordType: 'outbound_message',
    schemaVersion: SCHEMA_VERSION,
    createdAt: input.requestedAt,
    updatedAt: input.requestedAt,
    correlation: {
      ...input.request.correlation,
      outboundMessageId: input.outboundMessageId,
    },
    agentId: input.request.agentId,
    channelId: input.request.channelId,
    ...(input.request.inReplyToInboundMessageId
      ? { inReplyToInboundMessageId: input.request.inReplyToInboundMessageId }
      : {}),
    deliveryState: 'queued',
    requestedAt: input.requestedAt,
    sentAt: null,
    failedAt: null,
    deliveredAt: null,
    actions: input.request.actions,
    body: {
      text: input.request.text,
      artifacts: [],
    },
  };
}

function markOutboundFailed(
  message: OutboundMessage,
  failedAt: string,
  failureCode: string,
  failureMessage: string,
): OutboundMessage {
  return {
    ...message,
    updatedAt: failedAt,
    deliveryState: 'failed',
    failedAt,
    failureCode,
    failureMessage,
  };
}

function markOutboundSent(
  message: OutboundMessage,
  sentAt: string,
  externalMessageId: string,
): OutboundMessage {
  return {
    ...message,
    updatedAt: sentAt,
    deliveryState: 'sent',
    sentAt,
    failedAt: null,
    externalMessageId,
  };
}

async function persistFailure(options: {
  failureCode: string;
  failureMessage: string;
  logger: Logger;
  message: StoredRecord<OutboundMessage>;
  repositories: RepositoryBundle;
}): Promise<OutboundMessage> {
  const failedAt = new Date().toISOString();
  const failedMessage = markOutboundFailed(
    options.message.value,
    failedAt,
    options.failureCode,
    options.failureMessage,
  );
  const stored = await options.repositories.messages.saveOutboundDelivery({
    message: failedMessage,
    messageEtag: options.message.etag,
  });

  options.logger.warn('outbound_messaging.failed', {
    failureCode: failedMessage.failureCode,
    outboundMessageId: failedMessage.id,
  });
  return stored.message.value;
}

async function readTelegramBotToken(options: {
  agentId: string;
  credentialId: string;
  logger: Logger;
  repositories: RepositoryBundle;
}): Promise<
  | {
      botToken: string;
    }
  | {
      failureMessage: string;
    }
> {
  try {
    const botToken = await options.repositories.credentials.decryptCredential(
      options.agentId,
      options.credentialId,
    );
    if (!botToken) {
      return {
        failureMessage: `Telegram credential ${options.credentialId} is missing, unreadable, or revoked.`,
      };
    }

    return { botToken };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    options.logger.warn('outbound_messaging.credential_lookup_failed', {
      agentId: options.agentId,
      credentialId: options.credentialId,
      errorMessage,
    });

    return {
      failureMessage: `Telegram credential ${options.credentialId} could not be decrypted: ${errorMessage}`,
    };
  }
}

export function createOutboundMessagingService(options: {
  logger: Logger;
  repositories: RepositoryBundle;
  telegramBotApi: TelegramBotApiAdapter;
}): OutboundMessagingService {
  return {
    async sendMessage(input): Promise<OutboundMessage> {
      const requestedAt = new Date().toISOString();
      const outboundMessageId = createDeterministicOutboundMessageId(
        input.agentId,
        input.correlation.idempotencyKey,
      );

      let storedMessage: StoredRecord<OutboundMessage>;
      try {
        storedMessage = await options.repositories.messages.createOutboundMessage(
          buildQueuedOutboundMessage({
            outboundMessageId,
            requestedAt,
            request: input,
          }),
        );
      } catch (error) {
        if (!(error instanceof DuplicateRecordError)) {
          throw error;
        }

        const existing = await options.repositories.messages.getOutboundMessage(
          input.agentId,
          outboundMessageId,
        );
        if (!existing) {
          throw error;
        }

        options.logger.info('outbound_messaging.replayed', {
          deliveryState: existing.value.deliveryState,
          outboundMessageId,
        });
        return existing.value;
      }

      options.logger.info('outbound_messaging.queued', {
        agentId: input.agentId,
        channelId: input.channelId,
        outboundMessageId,
      });

      const channel = await options.repositories.channels.get(input.agentId, input.channelId);
      if (!channel) {
        return persistFailure({
          failureCode: 'channel_not_found',
          failureMessage: `Channel ${input.channelId} does not exist for agent ${input.agentId}.`,
          logger: options.logger,
          message: storedMessage,
          repositories: options.repositories,
        });
      }

      if (channel.value.provider !== 'telegram' || channel.value.state !== 'active') {
        return persistFailure({
          failureCode: 'channel_unavailable',
          failureMessage: `Channel ${input.channelId} is not an active Telegram channel.`,
          logger: options.logger,
          message: storedMessage,
          repositories: options.repositories,
        });
      }

      if (!channel.value.credentialId) {
        return persistFailure({
          failureCode: 'credential_unavailable',
          failureMessage: `Channel ${input.channelId} does not have a Telegram bot credential.`,
          logger: options.logger,
          message: storedMessage,
          repositories: options.repositories,
        });
      }

      if (!channel.value.externalChatId) {
        return persistFailure({
          failureCode: 'channel_not_bound',
          failureMessage: `Channel ${input.channelId} does not have a bound Telegram chat.`,
          logger: options.logger,
          message: storedMessage,
          repositories: options.repositories,
        });
      }

      const botTokenResult = await readTelegramBotToken({
        agentId: input.agentId,
        credentialId: channel.value.credentialId,
        logger: options.logger,
        repositories: options.repositories,
      });
      if (!('botToken' in botTokenResult)) {
        return persistFailure({
          failureCode: 'credential_unavailable',
          failureMessage: botTokenResult.failureMessage,
          logger: options.logger,
          message: storedMessage,
          repositories: options.repositories,
        });
      }

      const botToken = botTokenResult.botToken;

      let externalMessageId: string;
      try {
        ({ externalMessageId } = await options.telegramBotApi.sendMessage({
          actions: input.actions,
          botToken,
          chatId: channel.value.externalChatId,
          text: input.text,
        }));
      } catch (error) {
        if (error instanceof TelegramBotApiError) {
          return persistFailure({
            failureCode: error.details.failureCode,
            failureMessage: error.message,
            logger: options.logger,
            message: storedMessage,
            repositories: options.repositories,
          });
        }

        throw error;
      }

      let latestChannel = channel;
      for (let attempt = 0; attempt < OUTBOUND_CHANNEL_SAVE_RETRY_LIMIT; attempt += 1) {
        const sentAt = new Date().toISOString();
        const sentMessage = markOutboundSent(storedMessage.value, sentAt, externalMessageId);

        try {
          const stored = await options.repositories.messages.saveOutboundDelivery({
            channel: {
              ...latestChannel.value,
              updatedAt: sentAt,
              lastOutboundSentAt: sentAt,
              lastOutboundExternalMessageId: externalMessageId,
            },
            channelEtag: latestChannel.etag,
            message: sentMessage,
            messageEtag: storedMessage.etag,
          });

          options.logger.info('outbound_messaging.sent', {
            externalMessageId,
            outboundMessageId,
          });
          return stored.message.value;
        } catch (error) {
          if (!(error instanceof OptimisticConcurrencyError) || attempt === OUTBOUND_CHANNEL_SAVE_RETRY_LIMIT - 1) {
            throw error;
          }

          const reloadedChannel = await options.repositories.channels.get(input.agentId, input.channelId);
          if (!reloadedChannel) {
            throw error;
          }

          latestChannel = reloadedChannel;
        }
      }

      return storedMessage.value;
    },
  };
}

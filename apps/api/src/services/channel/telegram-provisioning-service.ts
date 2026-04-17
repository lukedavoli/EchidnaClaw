import { randomBytes } from 'node:crypto';

import type {
  AdminTelegramProvisioningHandoff,
  Agent,
  Channel,
  CorrelationMetadata,
  TelegramProvisioningSession,
  TelegramProvisioningSessionState,
} from '@echidna-claw/contracts';
import { adminTelegramProvisioningHandoffSchema } from '@echidna-claw/contracts';
import {
  buildTelegramProvisioningDeepLink,
  completeAgentProvisioning,
  createTelegramConversationUrl,
  createTelegramProvisioningBootstrapCode,
  createTelegramProvisioningBootstrapExpiry,
  createTelegramProvisioningSessionRecord,
  extractTelegramProvisioningBootstrapCode,
  isTelegramProvisioningBootstrapExpired,
  markAgentProvisioningStarted,
  recordAgentProvisioningFailure,
} from '@echidna-claw/domain';
import type { StoredRecord } from '@echidna-claw/persistence';
import { DuplicateRecordError } from '@echidna-claw/persistence';
import type { Logger } from '@echidna-claw/observability';

import type { RepositoryBundle } from '../../adapters/repositories/index.js';
import {
  TelegramBotApiError,
  type TelegramBotApiAdapter,
} from '../../adapters/telegram/index.js';
import type { ApiRuntimeConfig } from '../../config/api-runtime-config.js';
import {
  ConflictError,
  DependencyUnavailableError,
  NotFoundError,
  ValidationError,
} from '../../http/errors.js';
import type { CredentialLifecycleService } from '../runtime/credential-lifecycle-service.js';
import type { TelegramProvisioningService } from './contracts.js';

const TELEGRAM_BOTFATHER_URL = 'https://t.me/BotFather';

type RegistryEntry = {
  agent: StoredRecord<Agent>;
  primaryChannel: StoredRecord<Channel>;
};

function now(): string {
  return new Date().toISOString();
}

function createCorrelation(agentId: string): CorrelationMetadata {
  const suffix = randomBytes(12).toString('hex');

  return {
    idempotencyKey: `idem_${suffix}`,
    requestedBy: {
      id: `system:${agentId}`,
      kind: 'system',
    },
    traceId: `trc_${suffix}`,
  };
}

function normalizeHandle(handle: string | null | undefined): string | null {
  const normalized = handle?.replace(/^@+/, '').trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function createWebhookUrl(config: ApiRuntimeConfig, channelId: string): string {
  return `${config.publicBaseUrl.replace(/\/+$/, '')}/api/channels/telegram/${channelId}/webhook`;
}

function buildInstructions(input: {
  botHandle: string | null;
  openTelegramUrl: string | null;
  requiresBotToken: boolean;
  session: TelegramProvisioningSession;
}): string[] {
  switch (input.session.state) {
    case 'pending_operator_action':
      return [
        'Create a new Telegram bot in BotFather or choose the existing bot you want to hand off to this agent.',
        input.requiresBotToken
          ? 'Paste the bot token here so the platform can verify it and configure the webhook.'
          : 'A verified bot token is already stored. Submit a replacement token only if you need to change the bot identity.',
      ];
    case 'verifying_token':
      return [
        'The bot token is being verified against Telegram.',
        'If verification succeeds, the webhook and one-time bootstrap link will be prepared automatically.',
      ];
    case 'awaiting_operator_binding':
      return [
        input.openTelegramUrl
          ? 'Open the Telegram deep link from the intended operator account to send the one-time bootstrap code.'
          : 'Send `/start <bootstrap code>` to the bot from the intended operator account.',
        'Only that bootstrap message can bind the trusted Telegram user and chat to this agent.',
      ];
    case 'failed':
      return [
        input.session.lastErrorMessage ?? 'The last provisioning attempt failed.',
        input.requiresBotToken
          ? 'Retry the flow or paste a replacement bot token to start a fresh attempt.'
          : 'Retry the flow to rotate the bootstrap step, or paste a replacement token if the bot identity changed.',
      ];
    case 'completed':
      return [
        input.botHandle
          ? `Provisioning is complete and the bot @${input.botHandle} is active.`
          : 'Provisioning is complete and the Telegram bot is active.',
      ];
  }
}

function toHandoff(input: {
  agentId: string;
  channelId: string;
  session: TelegramProvisioningSession;
  fallbackBotDisplayName?: string | undefined;
  fallbackBotHandle?: string | undefined;
}): AdminTelegramProvisioningHandoff {
  const botHandle = normalizeHandle(input.session.botHandle ?? input.fallbackBotHandle ?? null);
  const botDisplayName =
    input.session.botDisplayName ?? input.fallbackBotDisplayName ?? null;
  const requiresBotToken =
    input.session.state !== 'completed' && input.session.credentialId == null;
  const openTelegramUrl =
    input.session.state === 'awaiting_operator_binding'
      ? buildTelegramProvisioningDeepLink(botHandle, input.session.bootstrapCode)
      : createTelegramConversationUrl(botHandle ?? undefined) ?? null;
  const operatorActionUrl =
    input.session.state === 'pending_operator_action' ||
    (input.session.state === 'failed' && requiresBotToken)
      ? TELEGRAM_BOTFATHER_URL
      : openTelegramUrl;

  return adminTelegramProvisioningHandoffSchema.parse({
    agentId: input.agentId,
    channelId: input.channelId,
    provider: 'telegram',
    attemptNumber: input.session.attemptNumber,
    state: input.session.state,
    requiresBotToken,
    botHandle,
    botDisplayName,
    openTelegramUrl,
    operatorActionUrl,
    instructions: buildInstructions({
      botHandle,
      openTelegramUrl,
      requiresBotToken,
      session: input.session,
    }),
    bootstrapCode:
      input.session.state === 'awaiting_operator_binding'
        ? input.session.bootstrapCode
        : null,
    bootstrapExpiresAt:
      input.session.state === 'awaiting_operator_binding'
        ? input.session.bootstrapExpiresAt
        : null,
    lastErrorCode: input.session.lastErrorCode,
    lastErrorMessage: input.session.lastErrorMessage,
  });
}

function canReuseVerifiedBinding(
  session: TelegramProvisioningSession,
): boolean {
  return (
    session.credentialId != null &&
    session.botUserId != null &&
    session.botHandle != null &&
    session.tokenVerifiedAt != null &&
    session.webhookConfiguredAt != null &&
    session.webhookUrl != null
  );
}

function createNextAttemptSession(input: {
  channel: Channel;
  previous: TelegramProvisioningSession;
  requestedAt: string;
}): TelegramProvisioningSession {
  const nextAttempt = createTelegramProvisioningSessionRecord({
    agentId: input.previous.agentId,
    channelId: input.previous.channelId,
    correlation: createCorrelation(input.previous.agentId),
    createdAt: input.requestedAt,
    attemptNumber: input.previous.attemptNumber + 1,
    flowKind: input.previous.flowKind,
  });

  if (!canReuseVerifiedBinding(input.previous)) {
    return nextAttempt;
  }

  return {
    ...nextAttempt,
    state: 'awaiting_operator_binding',
    credentialId: input.previous.credentialId,
    botUserId: input.previous.botUserId,
    botDisplayName: input.previous.botDisplayName,
    botHandle: input.previous.botHandle,
    webhookUrl: input.previous.webhookUrl,
    webhookConfiguredAt: input.previous.webhookConfiguredAt,
    bootstrapCode: createTelegramProvisioningBootstrapCode(),
    bootstrapExpiresAt: createTelegramProvisioningBootstrapExpiry(input.requestedAt),
    requestedAt: input.requestedAt,
    tokenVerifiedAt: input.previous.tokenVerifiedAt,
    updatedAt: input.requestedAt,
  };
}

function createFailedSessionFromChannel(input: {
  channel: Channel;
  previousAttemptNumber?: number;
}): TelegramProvisioningSession {
  const failedAt = input.channel.lastProvisioningFailedAt ?? input.channel.updatedAt;
  const session = createTelegramProvisioningSessionRecord({
    agentId: input.channel.agentId,
    channelId: input.channel.id,
    correlation: createCorrelation(input.channel.agentId),
    createdAt: failedAt,
    attemptNumber: input.previousAttemptNumber ?? 1,
  });

  return {
    ...session,
    failedAt,
    lastErrorCode: input.channel.lastProvisioningErrorCode ?? null,
    lastErrorMessage: input.channel.lastProvisioningErrorMessage ?? null,
    state: 'failed',
    updatedAt: failedAt,
  };
}

function toSessionFailure(
  session: TelegramProvisioningSession,
  failedAt: string,
  errorCode: string,
  errorMessage: string,
): TelegramProvisioningSession {
  return {
    ...session,
    bootstrapCode: null,
    bootstrapExpiresAt: null,
    failedAt,
    lastErrorCode: errorCode,
    lastErrorMessage: errorMessage,
    state: 'failed',
    updatedAt: failedAt,
  };
}

export function createTelegramProvisioningService(options: {
  config: ApiRuntimeConfig;
  credentialLifecycleService: CredentialLifecycleService;
  logger: Logger;
  repositories: RepositoryBundle;
  telegramBotApi: TelegramBotApiAdapter;
}): TelegramProvisioningService {
  async function getRegistryEntry(agentId: string): Promise<RegistryEntry> {
    const entry = await options.repositories.agentRegistry.getRegistryEntry(agentId);
    if (!entry || !entry.primaryChannel) {
      throw new NotFoundError('Agent not found.');
    }

    return {
      agent: entry.agent,
      primaryChannel: entry.primaryChannel,
    };
  }

  async function createSession(
    session: TelegramProvisioningSession,
  ): Promise<StoredRecord<TelegramProvisioningSession>> {
    try {
      return await options.repositories.telegramProvisioningSessions.create(session);
    } catch (error) {
      if (error instanceof DuplicateRecordError) {
        const existing = await options.repositories.telegramProvisioningSessions.getLatestByAgent(
          session.agentId,
        );
        if (existing) {
          return existing;
        }
      }

      throw error;
    }
  }

  async function replaceSession(
    session: TelegramProvisioningSession,
    expectedEtag: string,
  ): Promise<StoredRecord<TelegramProvisioningSession>> {
    return options.repositories.telegramProvisioningSessions.replace(session, expectedEtag);
  }

  async function ensureProvisioningStarted(
    entry: RegistryEntry,
    startedAt: string,
  ): Promise<RegistryEntry> {
    const next = markAgentProvisioningStarted({
      agent: entry.agent.value,
      primaryChannel: entry.primaryChannel.value,
      startedAt,
    });

    const storedAgent =
      next.agent.updatedAt === entry.agent.value.updatedAt &&
      next.agent.provisioningState === entry.agent.value.provisioningState
        ? entry.agent
        : await options.repositories.agents.replace(next.agent, entry.agent.etag);

    const storedChannel =
      next.primaryChannel.updatedAt === entry.primaryChannel.value.updatedAt &&
      next.primaryChannel.state === entry.primaryChannel.value.state
        ? entry.primaryChannel
        : await options.repositories.channels.replace(
            next.primaryChannel,
            entry.primaryChannel.etag,
          );

    return {
      agent: storedAgent,
      primaryChannel: storedChannel,
    };
  }

  async function recordFailure(input: {
    entry: RegistryEntry;
    errorCode: string;
    errorMessage: string;
    failedAt: string;
    session: StoredRecord<TelegramProvisioningSession>;
  }): Promise<StoredRecord<TelegramProvisioningSession>> {
    const failedSession = await replaceSession(
      toSessionFailure(
        input.session.value,
        input.failedAt,
        input.errorCode,
        input.errorMessage,
      ),
      input.session.etag,
    );

    const next = recordAgentProvisioningFailure({
      agent: input.entry.agent.value,
      primaryChannel: input.entry.primaryChannel.value,
      failedAt: input.failedAt,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
    });

    await options.repositories.agentRegistry.recordProvisioningFailure({
      agent: next.agent,
      agentEtag: input.entry.agent.etag,
      primaryChannel: next.primaryChannel,
      primaryChannelEtag: input.entry.primaryChannel.etag,
    });

    return failedSession;
  }

  async function ensureHandoffSession(
    entry: RegistryEntry,
  ): Promise<StoredRecord<TelegramProvisioningSession>> {
    const latest = await options.repositories.telegramProvisioningSessions.getLatestByAgent(
      entry.agent.value.id,
    );

    if (!latest) {
      if (entry.primaryChannel.value.state === 'provisioning_failed') {
        return createSession(
          createFailedSessionFromChannel({
            channel: entry.primaryChannel.value,
          }),
        );
      }

      return createSession(
        createTelegramProvisioningSessionRecord({
          agentId: entry.agent.value.id,
          channelId: entry.primaryChannel.value.id,
          correlation: createCorrelation(entry.agent.value.id),
          createdAt: entry.primaryChannel.value.provisioningRequestedAt,
          attemptNumber: 1,
        }),
      );
    }

    if (
      latest.value.state === 'awaiting_operator_binding' &&
      isTelegramProvisioningBootstrapExpired(latest.value.bootstrapExpiresAt, now())
    ) {
      return recordFailure({
        entry,
        errorCode: 'telegram_bootstrap_expired',
        errorMessage:
          'The Telegram bootstrap link expired before the operator completed the first /start handoff.',
        failedAt: now(),
        session: latest,
      });
    }

    if (entry.primaryChannel.value.state === 'provisioning_failed') {
      if (latest.value.state === 'failed') {
        return latest;
      }

      return replaceSession(
        createFailedSessionFromChannel({
          channel: entry.primaryChannel.value,
          previousAttemptNumber: latest.value.attemptNumber,
        }),
        latest.etag,
      );
    }

    if (
      entry.primaryChannel.value.state === 'pending_provisioning' &&
      (latest.value.state === 'failed' || latest.value.state === 'completed')
    ) {
      return createSession(
        createNextAttemptSession({
          channel: entry.primaryChannel.value,
          previous: latest.value,
          requestedAt:
            entry.primaryChannel.value.lastRecoveryRequestedAt ??
            entry.primaryChannel.value.updatedAt,
        }),
      );
    }

    return latest;
  }

  return {
    async getHandoff(agentId) {
      const entry = await getRegistryEntry(agentId);
      const session = await ensureHandoffSession(entry);

      return toHandoff({
        agentId: entry.agent.value.id,
        channelId: entry.primaryChannel.value.id,
        session: session.value,
        fallbackBotDisplayName: entry.primaryChannel.value.botDisplayName,
        fallbackBotHandle: entry.primaryChannel.value.externalHandle,
      });
    },

    async submitBotToken(input) {
      const requestedAt = now();
      let entry = await getRegistryEntry(input.agentId);
      let session = await ensureHandoffSession(entry);

      const nextSessionState: TelegramProvisioningSessionState =
        session.value.state === 'verifying_token'
          ? 'verifying_token'
          : 'verifying_token';

      if (session.value.state !== 'verifying_token') {
        session = await replaceSession(
          {
            ...session.value,
            failedAt: null,
            flowKind: input.flowKind ?? session.value.flowKind,
            lastErrorCode: null,
            lastErrorMessage: null,
            state: nextSessionState,
            updatedAt: requestedAt,
          },
          session.etag,
        );
      }

      entry = await ensureProvisioningStarted(entry, requestedAt);

      let botIdentity: Awaited<ReturnType<TelegramBotApiAdapter['getMe']>>;
      try {
        botIdentity = await options.telegramBotApi.getMe({ botToken: input.botToken });
      } catch (error) {
        const message =
          error instanceof TelegramBotApiError
            ? error.message
            : 'Telegram rejected the provided bot token.';

        await recordFailure({
          entry,
          errorCode: 'telegram_token_invalid',
          errorMessage: message,
          failedAt: now(),
          session,
        });
        throw new ValidationError('Telegram rejected the provided bot token.');
      }

      const credential = await options.credentialLifecycleService.upsertAgentCredentialFromPlaintext(
        {
          agentId: input.agentId,
          alias: 'telegram-bot-token',
          channelId: entry.primaryChannel.value.id,
          correlation: input.correlation,
          plaintext: input.botToken,
        },
      );

      const webhookUrl = createWebhookUrl(options.config, entry.primaryChannel.value.id);
      try {
        await options.telegramBotApi.setWebhook({
          botToken: input.botToken,
          secretToken: options.config.telegram.webhookSecretToken,
          webhookUrl,
        });
      } catch (error) {
        const message =
          error instanceof TelegramBotApiError
            ? error.message
            : 'Telegram webhook configuration failed.';

        await recordFailure({
          entry,
          errorCode: 'telegram_webhook_config_failed',
          errorMessage: message,
          failedAt: now(),
          session,
        });
        throw new DependencyUnavailableError(
          'The bot token was verified, but Telegram webhook setup failed.',
          { cause: error },
        );
      }

      const completedAt = now();
      const updatedSession = await replaceSession(
        {
          ...session.value,
          bootstrapCode: createTelegramProvisioningBootstrapCode(),
          bootstrapExpiresAt: createTelegramProvisioningBootstrapExpiry(completedAt),
          botDisplayName: botIdentity.displayName,
          botHandle: botIdentity.username,
          botUserId: botIdentity.botUserId,
          credentialId: credential.id,
          failedAt: null,
          flowKind: input.flowKind ?? session.value.flowKind,
          lastErrorCode: null,
          lastErrorMessage: null,
          state: 'awaiting_operator_binding',
          tokenVerifiedAt: completedAt,
          updatedAt: completedAt,
          webhookConfiguredAt: completedAt,
          webhookUrl,
        },
        session.etag,
      );

      const refreshedEntry = await getRegistryEntry(input.agentId);
      return toHandoff({
        agentId: refreshedEntry.agent.value.id,
        channelId: refreshedEntry.primaryChannel.value.id,
        session: updatedSession.value,
        fallbackBotDisplayName: refreshedEntry.primaryChannel.value.botDisplayName,
        fallbackBotHandle: refreshedEntry.primaryChannel.value.externalHandle,
      });
    },

    async evaluateBootstrapUpdate(input) {
      const session = await options.repositories.telegramProvisioningSessions.getActiveByChannel(
        input.channel.value.id,
      );
      if (!session || session.value.state !== 'awaiting_operator_binding') {
        return {
          handled: false,
          trusted: false,
        };
      }

      if (isTelegramProvisioningBootstrapExpired(session.value.bootstrapExpiresAt, input.receivedAt)) {
        const entry = await getRegistryEntry(input.channel.value.agentId);
        await recordFailure({
          entry,
          errorCode: 'telegram_bootstrap_expired',
          errorMessage:
            'The Telegram bootstrap link expired before the operator completed the first /start handoff.',
          failedAt: input.receivedAt,
          session,
        });

        return {
          handled: true,
          session,
          trusted: false,
          unsupportedType: 'provisioning:bootstrap_expired',
        };
      }

      if (
        input.normalized.kind !== 'text' ||
        input.normalized.chatType !== 'private' ||
        !input.normalized.sender ||
        input.normalized.senderIsBot
      ) {
        return {
          handled: true,
          session,
          trusted: false,
          unsupportedType: 'provisioning:bootstrap_requires_private_text',
        };
      }

      const providedCode = extractTelegramProvisioningBootstrapCode(input.normalized.text);
      if (!providedCode || providedCode !== session.value.bootstrapCode) {
        return {
          handled: true,
          session,
          trusted: false,
          unsupportedType: 'provisioning:bootstrap_mismatch',
        };
      }

      return {
        handled: true,
        session,
        trusted: true,
      };
    },

    async completeBootstrapBinding(input) {
      if (
        !input.normalized.externalChatId ||
        !input.normalized.sender ||
        !input.session.value.botUserId
      ) {
        const entry = await getRegistryEntry(input.agent.value.id);
        await recordFailure({
          entry,
          errorCode: 'telegram_bind_failed',
          errorMessage:
            'The bootstrap webhook did not include the Telegram identity details required to bind the bot.',
          failedAt: input.inboundMessage.receivedAt,
          session: input.session,
        });
        throw new ConflictError('Telegram provisioning could not bind the operator chat.');
      }

      const completed = completeAgentProvisioning({
        agent: input.agent.value,
        boundAt: input.inboundMessage.receivedAt,
        primaryChannel: {
          ...input.channel.value,
          externalChatId: input.normalized.externalChatId,
          trustedExternalDisplayName:
            input.normalized.sender.displayName ??
            input.channel.value.trustedExternalDisplayName,
          trustedExternalUserHandle:
            input.normalized.sender.externalUserHandle ??
            input.channel.value.trustedExternalUserHandle,
          trustedExternalUserId: input.normalized.sender.externalUserId,
        },
        botUserId: input.session.value.botUserId,
        externalChatId: input.normalized.externalChatId,
        ...(input.session.value.botDisplayName
          ? { botDisplayName: input.session.value.botDisplayName }
          : {}),
        ...(input.session.value.credentialId
          ? { credentialId: input.session.value.credentialId }
          : {}),
        ...(input.session.value.botHandle
          ? { externalHandle: input.session.value.botHandle }
          : {}),
      });

      await options.repositories.agentRegistry.completeProvisioning({
        agent: completed.agent,
        agentEtag: input.agent.etag,
        primaryChannel: completed.primaryChannel,
        primaryChannelEtag: input.channel.etag,
      });

      await replaceSession(
        {
          ...input.session.value,
          bindingInboundMessageId: input.inboundMessage.id,
          bootstrapCode: null,
          bootstrapExpiresAt: null,
          boundExternalChatId: input.normalized.externalChatId,
          boundTrustedExternalUserId: input.normalized.sender.externalUserId,
          completedAt: input.inboundMessage.receivedAt,
          failedAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          state: 'completed',
          updatedAt: input.inboundMessage.receivedAt,
        },
        input.session.etag,
      );

      options.logger.info('telegram_provisioning.completed', {
        agentId: input.agent.value.id,
        channelId: input.channel.value.id,
        sessionId: input.session.value.id,
      });
    },
  };
}

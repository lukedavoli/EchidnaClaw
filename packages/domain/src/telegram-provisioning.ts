import { createHash, randomBytes } from 'node:crypto';

import type {
  AgentId,
  ChannelId,
  CorrelationMetadata,
  TelegramProvisioningFlowKind,
  TelegramProvisioningSession,
  TelegramProvisioningSessionId,
} from '@echidna-claw/contracts';

const IDENTIFIER_HASH_LENGTH = 24;
const DEFAULT_BOOTSTRAP_TTL_MS = 30 * 60 * 1000;
const START_COMMAND_PATTERN = /^\/start(?:@[\w_]+)?(?:\s+(.+))?$/i;

function createDeterministicIdentifier(prefix: 'tps', source: string): string {
  const digest = createHash('sha256').update(source).digest('hex').slice(0, IDENTIFIER_HASH_LENGTH);
  return `${prefix}_${digest}`;
}

function normalizeTelegramHandle(handle: string | null | undefined): string | null {
  const normalizedHandle = handle?.replace(/^@+/, '').trim() ?? '';
  return normalizedHandle.length > 0 ? normalizedHandle : null;
}

export function createDeterministicTelegramProvisioningSessionId(
  agentId: AgentId,
  attemptNumber: number,
): TelegramProvisioningSessionId {
  return createDeterministicIdentifier(
    'tps',
    `telegram-provisioning:${agentId}:attempt:${attemptNumber}`,
  ) as TelegramProvisioningSessionId;
}

export function createTelegramProvisioningSessionRecord(input: {
  agentId: AgentId;
  channelId: ChannelId;
  correlation: CorrelationMetadata;
  createdAt: string;
  attemptNumber: number;
  flowKind?: TelegramProvisioningFlowKind;
}): TelegramProvisioningSession {
  return {
    id: createDeterministicTelegramProvisioningSessionId(input.agentId, input.attemptNumber),
    recordType: 'telegram_provisioning_session',
    schemaVersion: 1,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    correlation: input.correlation,
    agentId: input.agentId,
    channelId: input.channelId,
    provider: 'telegram',
    attemptNumber: input.attemptNumber,
    flowKind: input.flowKind ?? 'managed_bot',
    state: 'pending_operator_action',
    credentialId: null,
    botUserId: null,
    botDisplayName: null,
    botHandle: null,
    webhookUrl: null,
    webhookConfiguredAt: null,
    bootstrapCode: null,
    bootstrapExpiresAt: null,
    bindingInboundMessageId: null,
    boundExternalChatId: null,
    boundTrustedExternalUserId: null,
    requestedAt: input.createdAt,
    tokenVerifiedAt: null,
    completedAt: null,
    failedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
  };
}

export function createTelegramProvisioningBootstrapCode(): string {
  return randomBytes(12).toString('hex');
}

export function createTelegramProvisioningBootstrapExpiry(
  issuedAt: string,
  ttlMs = DEFAULT_BOOTSTRAP_TTL_MS,
): string {
  return new Date(Date.parse(issuedAt) + ttlMs).toISOString();
}

export function isTelegramProvisioningBootstrapExpired(
  expiresAt: string | null | undefined,
  asOf: string,
): boolean {
  if (!expiresAt) {
    return false;
  }

  return Date.parse(asOf) >= Date.parse(expiresAt);
}

export function extractTelegramProvisioningBootstrapCode(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const commandMatch = START_COMMAND_PATTERN.exec(trimmed);
  if (commandMatch) {
    const payload = commandMatch[1]?.trim() ?? '';
    return payload.length > 0 ? payload : null;
  }

  return trimmed;
}

export function buildTelegramProvisioningDeepLink(
  handle: string | null | undefined,
  bootstrapCode: string | null | undefined,
): string | null {
  const normalizedHandle = normalizeTelegramHandle(handle);
  const normalizedCode = bootstrapCode?.trim() ?? '';

  if (!normalizedHandle || normalizedCode.length === 0) {
    return null;
  }

  return `https://t.me/${normalizedHandle}?start=${encodeURIComponent(normalizedCode)}`;
}


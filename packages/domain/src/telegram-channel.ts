import { createHash } from 'node:crypto';

import type {
  AgentId,
  ApprovalId,
  ChannelUpdateKey,
  IdempotencyRecordId,
  InboundMessageId,
  OutboundMessageAction,
  OutboundMessageId,
} from '@echidna-claw/contracts';

const IDENTIFIER_HASH_LENGTH = 24;
const TELEGRAM_CALLBACK_VERSION = 'ec1';

export type DecodedTelegramCallbackAction = {
  kind: 'approval_decision';
  approvalId: ApprovalId;
  decision: 'approve' | 'reject';
};

function createDeterministicIdentifier(
  prefix: 'idr' | 'inm' | 'out' | 'upd',
  source: string,
): string {
  const digest = createHash('sha256').update(source).digest('hex').slice(0, IDENTIFIER_HASH_LENGTH);
  return `${prefix}_${digest}`;
}

export function createDeterministicInboundMessageId(
  agentId: AgentId,
  externalUpdateId: string,
): InboundMessageId {
  return createDeterministicIdentifier('inm', `telegram-inbound:${agentId}:${externalUpdateId}`) as InboundMessageId;
}

export function createDeterministicOutboundMessageId(
  agentId: AgentId,
  idempotencyKey: string,
): OutboundMessageId {
  return createDeterministicIdentifier('out', `telegram-outbound:${agentId}:${idempotencyKey}`) as OutboundMessageId;
}

export function createDeterministicIdempotencyRecordId(
  agentId: AgentId,
  scope: string,
  key: string,
): IdempotencyRecordId {
  return createDeterministicIdentifier('idr', `idempotency:${agentId}:${scope}:${key}`) as IdempotencyRecordId;
}

export function createTelegramChannelUpdateKey(
  agentId: AgentId,
  externalUpdateId: string,
): ChannelUpdateKey {
  return createDeterministicIdentifier('upd', `telegram-update:${agentId}:${externalUpdateId}`) as ChannelUpdateKey;
}

export function encodeTelegramCallbackData(action: OutboundMessageAction): string {
  switch (action.kind) {
    case 'approval_decision':
      return `${TELEGRAM_CALLBACK_VERSION}|a|${action.approvalId}|${
        action.decision === 'approve' ? 'y' : 'n'
      }`;
    default:
      return `${TELEGRAM_CALLBACK_VERSION}|x|unsupported|n`;
  }
}

export function decodeTelegramCallbackData(data: string): DecodedTelegramCallbackAction | null {
  const [version, kind, approvalId, decision] = data.trim().split('|');

  if (
    version !== TELEGRAM_CALLBACK_VERSION ||
    kind !== 'a' ||
    !approvalId?.startsWith('apr_') ||
    (decision !== 'y' && decision !== 'n')
  ) {
    return null;
  }

  return {
    kind: 'approval_decision',
    approvalId: approvalId as ApprovalId,
    decision: decision === 'y' ? 'approve' : 'reject',
  };
}

export function buildTelegramDisplayName(input: {
  externalUserId: string;
  firstName?: string;
  lastName?: string;
  username?: string;
}): string | undefined {
  const fullName = [input.firstName?.trim(), input.lastName?.trim()].filter(Boolean).join(' ').trim();
  if (fullName.length > 0) {
    return fullName;
  }

  const username = input.username?.trim();
  if (username) {
    return `@${username.replace(/^@+/, '')}`;
  }

  return input.externalUserId.trim() || undefined;
}

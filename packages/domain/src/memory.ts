import type { Channel, HeadTriggerKind, InboundMessage } from '@echidna-claw/contracts';

function sanitizeMemoryIdentifierPart(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return sanitized || 'default';
}

export function buildAgentMemoryStoreName(input: {
  agentId: string;
  storeNamePrefix: string;
}): string {
  return [
    sanitizeMemoryIdentifierPart(input.storeNamePrefix),
    sanitizeMemoryIdentifierPart(input.agentId),
  ].join('-');
}

export function buildTrustedMemoryScopeKey(input: {
  provider: Channel['provider'];
  trustedExternalUserId?: string | null | undefined;
}): string | null {
  const trustedExternalUserId = input.trustedExternalUserId?.trim();
  if (!trustedExternalUserId) {
    return null;
  }

  return [
    sanitizeMemoryIdentifierPart(input.provider),
    sanitizeMemoryIdentifierPart(trustedExternalUserId),
  ].join('-');
}

export function filterMemoryEligibleMessages(
  messages: readonly InboundMessage[],
): InboundMessage[] {
  return messages.filter(
    (message) =>
      message.kind === 'text' &&
      message.trusted &&
      !message.redacted &&
      message.sensitiveInputKind == null &&
      message.body.text.trim().length > 0,
  );
}

export function shouldAttemptMemoryRead(input: {
  bindingAvailable: boolean;
  items: readonly { text: string }[];
}): boolean {
  return input.bindingAvailable && input.items.some((item) => item.text.trim().length > 0);
}

export function shouldAttemptMemoryWrite(input: {
  allowTriggerKinds: readonly HeadTriggerKind[];
  bindingAvailable: boolean;
  eligibleMessages: readonly InboundMessage[];
  triggerKind: HeadTriggerKind;
}): boolean {
  return (
    input.bindingAvailable &&
    input.allowTriggerKinds.includes(input.triggerKind) &&
    filterMemoryEligibleMessages(input.eligibleMessages).length > 0
  );
}

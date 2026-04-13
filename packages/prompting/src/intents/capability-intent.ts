import type { HeadTrigger } from '@echidna-claw/contracts';

const CAPABILITY_PATTERNS = [
  /\bwhat can you do\b/i,
  /\bwhat tools do you have\b/i,
  /\bwhat integrations do you support\b/i,
  /\bcan you access\b/i,
  /\bwhat are your capabilities\b/i,
  /\bwhat do you have access to\b/i,
];

export function shouldIncludeCapabilitySkill(input: {
  latestTrustedMessageText?: string | null | undefined;
  triggerKind: HeadTrigger['kind'];
}): boolean {
  if (input.triggerKind !== 'trusted_messages') {
    return false;
  }

  const text = input.latestTrustedMessageText?.trim();
  if (!text) {
    return false;
  }

  return CAPABILITY_PATTERNS.some((pattern) => pattern.test(text));
}

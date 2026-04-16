import type { HeadEffectSummary } from '@echidna-claw/contracts';

import type { FoundryHeadTurnResult, HeadRuntimeAdapter, PreparedHeadTurnInput } from './types.js';

function createEmptyEffectSummary(): HeadEffectSummary {
  return {
    taskRequested: false,
    scheduleChangeRequested: false,
    approvalRequested: false,
    credentialRequested: false,
    sandboxRequested: false,
    memoryOperationRequested: false,
  };
}

function renderStubReply(input: PreparedHeadTurnInput): string | null {
  if (input.prompt.includedCapabilitySkill && input.capabilitySummary) {
    return input.capabilitySummary;
  }

  const latestInput = input.modelInput.at(-1)?.text?.trim();
  if (!latestInput) {
    return 'Head runtime completed without new user-visible work.';
  }

  if (input.modelInput.at(-1)?.role === 'developer') {
    return `Processed due-task trigger: ${latestInput}`;
  }

  return `Stubbed Head reply: ${latestInput}`;
}

export function createLocalHeadRuntimeAdapter(): HeadRuntimeAdapter {
  return {
    async cancelTurn(): Promise<void> {
      return;
    },

    async executeTurn(input: PreparedHeadTurnInput): Promise<FoundryHeadTurnResult> {
      const assistantText = renderStubReply(input);

      return {
        assistantText,
        completionKind: assistantText ? 'reply' : 'no_op',
        conversationCursor: input.conversationCursor ?? `stub-conversation:${input.headTurnId}`,
        effectSummary: createEmptyEffectSummary(),
        providerConversationId: input.conversationCursor ?? `stub-conversation:${input.headTurnId}`,
        providerRunId: `stub-run:${input.headTurnId}`,
      };
    },
  };
}

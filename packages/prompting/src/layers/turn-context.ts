import type { HeadTrigger, WorkingContext } from '@echidna-claw/contracts';

export type PromptToolDescriptor = {
  description: string;
  name: string;
};

function renderTriggerSummary(trigger: HeadTrigger, latestTrustedMessageText?: string | null): string[] {
  if (trigger.kind === 'trusted_messages') {
    return [
      'Trigger: trusted_messages',
      `Channel: ${trigger.channelId}`,
      `Inbound message ids: ${trigger.inboundMessageIds.join(', ')}`,
      `Read through sequence: ${trigger.readThroughMessageSequence}`,
      latestTrustedMessageText
        ? `Latest trusted message text: ${latestTrustedMessageText}`
        : 'Latest trusted message text: unavailable',
    ];
  }

  return [
    'Trigger: due_task',
    `Task id: ${trigger.taskId ?? 'none'}`,
    `Schedule id: ${trigger.scheduleId ?? 'none'}`,
    `Due at: ${trigger.dueAt}`,
  ];
}

export function renderTurnContextLayer(input: {
  enabledTools: readonly PromptToolDescriptor[];
  latestTrustedMessageText?: string | null | undefined;
  runtimeMode: 'local-minimal' | 'shared-cloud' | 'cloud-deployed';
  webSearchEnabled: boolean;
  workingContext: WorkingContext;
  trigger: HeadTrigger;
}): string {
  const lines = ['# Turn Context', ...renderTriggerSummary(input.trigger, input.latestTrustedMessageText)];

  lines.push(`Working-context summary: ${input.workingContext.summary || 'No summary is currently stored.'}`);
  lines.push(`Current objective: ${input.workingContext.currentObjective ?? 'none'}`);
  lines.push(`Open questions: ${input.workingContext.openQuestions.join(', ') || 'none'}`);
  lines.push(`Latest Hands status: ${input.workingContext.latestHandsStatus ?? 'none'}`);
  lines.push(`Open task ids: ${input.workingContext.openTaskIds.join(', ') || 'none'}`);
  lines.push(`Pending approval ids: ${input.workingContext.pendingApprovalIds.join(', ') || 'none'}`);
  lines.push(`Latest inbound sequence: ${input.workingContext.latestInboundSequence}`);
  lines.push(`Latest processed sequence: ${input.workingContext.latestProcessedSequence}`);
  lines.push(`Episode local date: ${input.workingContext.episodeLocalDate ?? 'unset'}`);
  lines.push(`Episode turn count: ${input.workingContext.episodeTurnCount}`);
  lines.push(
    `Conversation cursor: ${input.workingContext.conversationCursor ?? 'none yet; create one if the provider requires it'}`,
  );
  lines.push(`Runtime mode: ${input.runtimeMode}`);
  lines.push(`Web search enabled: ${input.webSearchEnabled ? 'yes' : 'no'}`);

  if (input.enabledTools.length === 0) {
    lines.push('Enabled tools: none');
  } else {
    lines.push('Enabled tools:');
    for (const tool of input.enabledTools) {
      lines.push(`- ${tool.name}: ${tool.description}`);
    }
  }

  return lines.join('\n');
}

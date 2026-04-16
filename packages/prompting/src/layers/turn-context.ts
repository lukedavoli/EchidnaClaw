import type { HeadTrigger, WorkingContext } from '@echidna-claw/contracts';

export type PromptToolDescriptor = {
  description: string;
  name: string;
};

export type DueTaskPromptContext = {
  origin: 'one_off' | 'schedule';
  schedule?: {
    description: string;
    lastMaterializedOccurrenceAt: string | null;
    naturalLanguageRequest: string;
    nextDueAt: string | null;
    recurrenceSummary: string;
    scheduleId: string;
  };
  task?: {
    dueAt: string | null;
    notes: string;
    progressHeadline: string | null;
    queueLabel: string;
    requestedByKind: string;
    requestedOutcome: string;
    scheduleId: string | null;
    state: string;
    taskId: string;
    taskType: string;
  };
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

function renderDueTaskContext(context: DueTaskPromptContext | undefined): string[] {
  if (!context) {
    return [];
  }

  const lines = [`Due task origin: ${context.origin}`];

  if (context.task) {
    lines.push(`Due task requested outcome: ${context.task.requestedOutcome}`);
    lines.push(`Due task type/state: ${context.task.taskType} / ${context.task.state}`);
    lines.push(`Due task queue: ${context.task.queueLabel}`);
    lines.push(`Due task requested by: ${context.task.requestedByKind}`);
    lines.push(`Due task notes: ${context.task.notes || 'none'}`);
    lines.push(`Due task progress: ${context.task.progressHeadline ?? 'none'}`);
  }

  if (context.schedule) {
    lines.push(`Schedule description: ${context.schedule.description}`);
    lines.push(`Schedule request: ${context.schedule.naturalLanguageRequest}`);
    lines.push(`Schedule recurrence: ${context.schedule.recurrenceSummary}`);
    lines.push(
      `Schedule materialization: last=${context.schedule.lastMaterializedOccurrenceAt ?? 'none'} next=${context.schedule.nextDueAt ?? 'none'}`,
    );
  }

  return lines;
}

export function renderTurnContextLayer(input: {
  dueTaskContext?: DueTaskPromptContext;
  enabledTools: readonly PromptToolDescriptor[];
  latestTrustedMessageText?: string | null | undefined;
  runtimeMode: 'local-minimal' | 'shared-cloud' | 'cloud-deployed';
  webSearchEnabled: boolean;
  workingContext: WorkingContext;
  trigger: HeadTrigger;
}): string {
  const lines = ['# Turn Context', ...renderTriggerSummary(input.trigger, input.latestTrustedMessageText)];

  lines.push(
    `Working-context summary (operational state, not durable memory): ${input.workingContext.summary || 'No summary is currently stored.'}`,
  );
  lines.push(`Current objective: ${input.workingContext.currentObjective ?? 'none'}`);
  lines.push(`Open questions: ${input.workingContext.openQuestions.join(', ') || 'none'}`);
  lines.push(`Latest Hands status: ${input.workingContext.latestHandsStatus ?? 'none'}`);
  lines.push(`Open task ids: ${input.workingContext.openTaskIds.join(', ') || 'none'}`);
  lines.push(`Pending approval ids: ${input.workingContext.pendingApprovalIds.join(', ') || 'none'}`);
  lines.push(`Latest inbound sequence: ${input.workingContext.latestInboundSequence}`);
  lines.push(`Latest processed sequence: ${input.workingContext.latestProcessedSequence}`);
  lines.push(`Episode local date: ${input.workingContext.episodeLocalDate ?? 'unset'}`);
  lines.push(`Episode turn count: ${input.workingContext.episodeTurnCount}`);
  lines.push(...renderDueTaskContext(input.dueTaskContext));
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

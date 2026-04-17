import type {
  Agent,
  HeadTrigger,
  InboundMessage,
  WorkingContext,
} from '@echidna-claw/contracts';
import type { Logger } from '@echidna-claw/observability';

import type {
  WorkingContextSummarizerAdapter,
  WorkingContextSummaryInput,
  WorkingContextSummaryResult,
} from '../../adapters/foundry/index.js';

export interface WorkingContextSummarySnapshot {
  currentObjective: string | null;
  latestHandsStatus: string | null;
  openQuestions: string[];
  summary: string;
  summaryUpdatedAt: string;
  usage: WorkingContextSummaryResult['usage'];
}

export interface WorkingContextSummaryService {
  refreshAfterHandsEvent(input: {
    agent: Agent;
    eventSummary: string;
    refreshedAt: string;
    workingContext: WorkingContext;
  }): Promise<WorkingContextSummarySnapshot>;
  refreshAfterTrustedTurn(input: {
    agent: Agent;
    assistantReplyText: string | null;
    completedAt: string;
    trigger: HeadTrigger;
    trustedMessages: InboundMessage[];
    workingContext: WorkingContext;
  }): Promise<WorkingContextSummarySnapshot>;
}

function createFallbackSummary(input: {
  assistantReplyText: string | null;
  completedAt: string;
  latestHandsStatus: string | null;
  previousSummary: string;
  trustedMessages: InboundMessage[];
  workingContext: WorkingContext;
}): WorkingContextSummarySnapshot {
  const latestUserText = input.trustedMessages.at(-1)?.body.text?.trim() ?? null;
  const summary = [latestUserText ? `Latest user turn: ${latestUserText}` : null, input.assistantReplyText]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(' ');

  return {
    currentObjective: latestUserText ?? input.workingContext.currentObjective,
    latestHandsStatus: input.latestHandsStatus,
    openQuestions:
      input.assistantReplyText?.trim().endsWith('?') === true
        ? [input.assistantReplyText.trim()]
        : [],
    summary: summary || input.previousSummary || 'No operational summary is currently available.',
    summaryUpdatedAt: input.completedAt,
    usage: null,
  };
}

function normalizeSummaryResult(
  result: WorkingContextSummaryResult,
  completedAt: string,
  previousSummary: string,
): WorkingContextSummarySnapshot {
  return {
    currentObjective: result.currentObjective,
    latestHandsStatus: result.latestHandsStatus,
    openQuestions: result.openQuestions,
    summary: result.summary.trim() || previousSummary || 'No operational summary is currently available.',
    summaryUpdatedAt: completedAt,
    usage: result.usage,
  };
}

function buildSummarizerInput(input: {
  agent: Agent;
  assistantReplyText: string | null;
  trigger: HeadTrigger;
  trustedMessages: InboundMessage[];
  workingContext: WorkingContext;
}): WorkingContextSummaryInput {
  return {
    agentId: input.agent.id,
    agentName: input.agent.name,
    assistantReplyText: input.assistantReplyText,
    currentObjective: input.workingContext.currentObjective,
    latestHandsStatus: input.workingContext.latestHandsStatus,
    openQuestions: input.workingContext.openQuestions,
    openTaskIds: input.workingContext.openTaskIds,
    pendingApprovalIds: input.workingContext.pendingApprovalIds,
    previousSummary: input.workingContext.summary,
    timeZone: input.agent.timeZone,
    triggerKind: input.trigger.kind,
    trustedMessages: input.trustedMessages.map((message) => ({
      id: message.id,
      sequence: message.sequence,
      text: message.body.text,
    })),
  };
}

export function createWorkingContextSummaryService(options: {
  logger: Logger;
  summarizer: WorkingContextSummarizerAdapter;
}): WorkingContextSummaryService {
  return {
    async refreshAfterTrustedTurn(input): Promise<WorkingContextSummarySnapshot> {
      try {
        const result = await options.summarizer.summarize(
          buildSummarizerInput({
            agent: input.agent,
            assistantReplyText: input.assistantReplyText,
            trigger: input.trigger,
            trustedMessages: input.trustedMessages,
            workingContext: input.workingContext,
          }),
        );

        return normalizeSummaryResult(
          result,
          input.completedAt,
          input.workingContext.summary,
        );
      } catch (error) {
        options.logger.warn('working_context_summary.refresh_failed', {
          agentId: input.agent.id,
          message: error instanceof Error ? error.message : 'Unknown summarizer failure.',
        });

        return createFallbackSummary({
          assistantReplyText: input.assistantReplyText,
          completedAt: input.completedAt,
          latestHandsStatus: input.workingContext.latestHandsStatus,
          previousSummary: input.workingContext.summary,
          trustedMessages: input.trustedMessages,
          workingContext: input.workingContext,
        });
      }
    },

    async refreshAfterHandsEvent(input): Promise<WorkingContextSummarySnapshot> {
      return {
        currentObjective: input.workingContext.currentObjective,
        latestHandsStatus: input.eventSummary,
        openQuestions: input.workingContext.openQuestions,
        summary: input.workingContext.summary || input.eventSummary,
        summaryUpdatedAt: input.refreshedAt,
        usage: null,
      };
    },
  };
}

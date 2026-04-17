import type {
  WorkingContextSummarizerAdapter,
  WorkingContextSummaryInput,
  WorkingContextSummaryResult,
} from './types.js';

function truncateText(text: string | null | undefined, limit = 160): string | null {
  const normalized = text?.trim();
  if (!normalized) {
    return null;
  }

  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}...`;
}

function deriveOpenQuestions(input: WorkingContextSummaryInput): string[] {
  const assistantQuestion = truncateText(input.assistantReplyText, 200);
  if (assistantQuestion && assistantQuestion.endsWith('?')) {
    return [assistantQuestion];
  }

  return [];
}

export function createLocalWorkingContextSummarizerAdapter(): WorkingContextSummarizerAdapter {
  return {
    async summarize(input): Promise<WorkingContextSummaryResult> {
      const latestUserText = truncateText(input.trustedMessages.at(-1)?.text ?? null, 200);
      const assistantReplyText = truncateText(input.assistantReplyText, 200);
      const summaryParts: string[] = [];

      if (latestUserText) {
        summaryParts.push(`Latest user turn: ${latestUserText}`);
      }

      if (assistantReplyText) {
        summaryParts.push(`Latest assistant reply: ${assistantReplyText}`);
      }

      if (summaryParts.length === 0) {
        summaryParts.push(input.previousSummary || 'No operational summary is currently available.');
      }

      return {
        currentObjective: latestUserText ?? input.currentObjective,
        latestHandsStatus: input.latestHandsStatus,
        openQuestions: deriveOpenQuestions(input),
        summary: summaryParts.join(' '),
        usage: null,
      };
    },
  };
}

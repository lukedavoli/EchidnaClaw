import { AIProjectClient } from '@azure/ai-projects';
import { DefaultAzureCredential } from '@azure/identity';
import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';

import type {
  WorkingContextSummarizerAdapter,
  WorkingContextSummaryInput,
  WorkingContextSummaryResult,
} from './types.js';

type OpenAIClient = ReturnType<AIProjectClient['getOpenAIClient']>;

function createFallbackSummary(input: WorkingContextSummaryInput): WorkingContextSummaryResult {
  const latestUserText = input.trustedMessages.at(-1)?.text?.trim() || null;

  return {
    currentObjective: latestUserText ?? input.currentObjective,
    latestHandsStatus: input.latestHandsStatus,
    openQuestions: [],
    summary:
      input.previousSummary ||
      latestUserText ||
      'No operational summary is currently available.',
  };
}

function buildInputText(input: WorkingContextSummaryInput): string {
  return JSON.stringify(
    {
      agentName: input.agentName,
      assistantReplyText: input.assistantReplyText,
      currentObjective: input.currentObjective,
      latestHandsStatus: input.latestHandsStatus,
      openQuestions: input.openQuestions,
      openTaskIds: input.openTaskIds,
      pendingApprovalIds: input.pendingApprovalIds,
      previousSummary: input.previousSummary,
      timeZone: input.timeZone,
      triggerKind: input.triggerKind,
      trustedMessages: input.trustedMessages,
    },
    null,
    2,
  );
}

export function createLiveWorkingContextSummarizerAdapter(options: {
  defaultDeploymentName: string;
  projectEndpoint: string;
}): WorkingContextSummarizerAdapter {
  const projectClient = new AIProjectClient(
    options.projectEndpoint,
    new DefaultAzureCredential(),
  );
  const openAIClient: OpenAIClient = projectClient.getOpenAIClient();

  return {
    async summarize(input): Promise<WorkingContextSummaryResult> {
      const request: ResponseCreateParamsNonStreaming = {
        input: [
          {
            content: [
              {
                text: buildInputText(input),
                type: 'input_text',
              },
            ],
            role: 'user',
            type: 'message',
          },
        ],
        instructions: [
          'Produce only compact JSON with keys: summary, currentObjective, latestHandsStatus, openQuestions.',
          'summary must be a concise operational carry-forward summary.',
          'currentObjective and latestHandsStatus must be null or short strings.',
          'openQuestions must be an array of short user-facing questions that remain unresolved.',
        ].join(' '),
        metadata: {
          agentId: input.agentId,
        },
        model: options.defaultDeploymentName,
        safety_identifier: input.agentId,
        truncation: 'auto',
      };

      const response = await openAIClient.responses.create(request);
      const outputText = response.output_text.trim();

      if (!outputText) {
        return createFallbackSummary(input);
      }

      try {
        const parsed = JSON.parse(outputText) as Partial<WorkingContextSummaryResult>;
        return {
          currentObjective:
            typeof parsed.currentObjective === 'string' ? parsed.currentObjective : null,
          latestHandsStatus:
            typeof parsed.latestHandsStatus === 'string' ? parsed.latestHandsStatus : null,
          openQuestions: Array.isArray(parsed.openQuestions)
            ? parsed.openQuestions.filter(
                (value): value is string => typeof value === 'string' && value.trim().length > 0,
              )
            : [],
          summary:
            typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
              ? parsed.summary
              : createFallbackSummary(input).summary,
        };
      } catch {
        return createFallbackSummary(input);
      }
    },
  };
}

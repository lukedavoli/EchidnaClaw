import { z } from 'zod';

import type {
  ConversationMemoryContext,
  ConversationMemoryService,
} from '../conversation-memory-service.js';

export const memoryWriteArgsSchema = z
  .object({
    category: z.enum([
      'preference',
      'standing_instruction',
      'durable_fact',
      'recurring_pattern',
      'agent_guidance',
    ]),
    text: z.string().trim().min(1),
  })
  .strict();

export async function handleMemoryWrite(input: {
  args: unknown;
  context: ConversationMemoryContext;
  conversationMemoryService: ConversationMemoryService;
}): Promise<{
  deferredDirectives: [
    {
      kind: 'memory_write';
      candidate: ReturnType<ConversationMemoryService['createWriteCandidate']>;
    },
  ];
  effectSummaryPatch: {
    memoryOperationRequested: true;
  };
  outputText: string;
}> {
  const args = memoryWriteArgsSchema.parse(input.args);
  const candidate = input.conversationMemoryService.createWriteCandidate({
    category: args.category,
    context: input.context,
    text: args.text,
  });

  return {
    deferredDirectives: [
      {
        kind: 'memory_write',
        candidate,
      },
    ],
    effectSummaryPatch: {
      memoryOperationRequested: true,
    },
    outputText:
      `Durable memory write staged for ${candidate.category.replaceAll('_', ' ')}.` +
      ' It will only be committed if this turn survives the stale-turn check.',
  };
}

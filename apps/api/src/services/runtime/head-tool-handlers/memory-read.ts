import type { RepositoryConfig } from '@echidna-claw/contracts';
import { z } from 'zod';

import type {
  ConversationMemoryContext,
  ConversationMemoryService,
} from '../conversation-memory-service.js';

export const memoryReadArgsSchema = z
  .object({
    query: z.string().trim().min(1),
  })
  .strict();

function formatMemories(
  memories: Awaited<ReturnType<ConversationMemoryService['read']>>['memories'],
): string {
  if (memories.length === 0) {
    return 'No relevant durable memory matched that query.';
  }

  return [
    'Durable memory results:',
    ...memories.map((memory) => `- [${memory.kind}] ${memory.text}`),
  ].join('\n');
}

export async function handleMemoryRead(input: {
  args: unknown;
  context: ConversationMemoryContext;
  conversationMemoryService: ConversationMemoryService;
  repositoryConfig: RepositoryConfig;
}): Promise<{
  effectSummaryPatch: {
    memoryOperationRequested: true;
  };
  outputText: string;
}> {
  const args = memoryReadArgsSchema.parse(input.args);
  const result = await input.conversationMemoryService.read({
    context: input.context,
    query: args.query,
    repositoryConfig: input.repositoryConfig,
  });

  return {
    effectSummaryPatch: {
      memoryOperationRequested: true,
    },
    outputText: input.context.binding
      ? formatMemories(result.memories)
      : 'Durable memory is unavailable because this agent does not yet have a trusted memory scope.',
  };
}

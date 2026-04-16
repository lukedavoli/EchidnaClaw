import type {
  Agent,
  Channel,
  HeadTrigger,
  InboundMessage,
  RepositoryConfig,
} from '@echidna-claw/contracts';
import {
  buildAgentMemoryStoreName,
  buildTrustedMemoryScopeKey,
  filterMemoryEligibleMessages,
  shouldAttemptMemoryRead,
  shouldAttemptMemoryWrite,
} from '@echidna-claw/domain';
import type { Logger } from '@echidna-claw/observability';

import type {
  MemoryScopeBinding,
  MemorySearchInputItem,
  MemorySearchResult,
  MemoryStoreAdapter,
  MemoryWriteCandidate,
  RetrievedMemory,
} from '../../adapters/foundry/index.js';

const WRITE_POLICY_CATEGORY: Record<
  MemoryWriteCandidate['category'],
  RepositoryConfig['memory']['policy']['remember'][number]
> = {
  agent_guidance: 'agent_guidance',
  durable_fact: 'durable_facts',
  preference: 'preferences',
  recurring_pattern: 'recurring_patterns',
  standing_instruction: 'standing_instructions',
};

function clipText(text: string, limit: number): string {
  const normalized = text.trim();
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(1, limit - 1)).trimEnd()}...`;
}

function uniqueMemories(memories: readonly RetrievedMemory[]): RetrievedMemory[] {
  const seen = new Set<string>();
  const deduped: RetrievedMemory[] = [];

  for (const memory of memories) {
    const key = `${memory.kind}:${memory.text.trim().toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(memory);
  }

  return deduped;
}

function buildBinding(input: {
  agent: Agent;
  channel: Channel;
  repositoryConfig: RepositoryConfig;
}): MemoryScopeBinding | null {
  const scopeKey = buildTrustedMemoryScopeKey({
    provider: input.channel.provider,
    trustedExternalUserId: input.channel.trustedExternalUserId,
  });
  if (!scopeKey) {
    return null;
  }

  return {
    provider: input.channel.provider,
    scopeKey,
    storeName: buildAgentMemoryStoreName({
      agentId: input.agent.id,
      storeNamePrefix: input.repositoryConfig.memory.storeNamePrefix,
    }),
  };
}

function buildTrustedTurnItems(messages: readonly InboundMessage[]): MemorySearchInputItem[] {
  return filterMemoryEligibleMessages(messages).map((message) => ({
    role: 'user',
    text: message.body.text.trim(),
  }));
}

function buildDueTaskItems(
  modelInput: readonly {
    role: 'developer' | 'system' | 'user';
    text: string;
  }[],
): MemorySearchInputItem[] {
  return modelInput
    .filter(
      (
        item,
      ): item is {
        role: 'developer' | 'user';
        text: string;
      } => item.role !== 'system' && item.text.trim().length > 0,
    )
    .map((item) => ({
      role: item.role,
      text: item.text.trim(),
    }));
}

function normalizeRetrievedMemories(input: {
  maxCharsPerItem: number;
  maxItems: number;
  memories: readonly RetrievedMemory[];
}): RetrievedMemory[] {
  return uniqueMemories(
    input.memories.map((memory) => ({
      ...memory,
      text: clipText(memory.text, input.maxCharsPerItem),
    })),
  ).slice(0, input.maxItems);
}

function dedupeWriteCandidates(
  candidates: readonly MemoryWriteCandidate[],
): MemoryWriteCandidate[] {
  const seen = new Set<string>();
  const deduped: MemoryWriteCandidate[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.category}:${candidate.text.trim().toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

export interface ConversationMemoryContext {
  baselineItems: MemorySearchInputItem[];
  binding: MemoryScopeBinding | null;
  lastSearchId: string | null;
  promptMemories: RetrievedMemory[];
  readAllowed: boolean;
  writeAllowed: boolean;
}

export interface ConversationMemoryService {
  commitWrites(input: {
    candidates: MemoryWriteCandidate[];
    context: ConversationMemoryContext;
  }): Promise<{ updateIds: string[] }>;
  createWriteCandidate(input: {
    category: MemoryWriteCandidate['category'];
    context: ConversationMemoryContext;
    text: string;
  }): MemoryWriteCandidate;
  loadTurnContext(input: {
    agent: Agent;
    channel: Channel;
    messages: InboundMessage[];
    modelInput: Array<{
      role: 'developer' | 'system' | 'user';
      text: string;
    }>;
    repositoryConfig: RepositoryConfig;
    trigger: HeadTrigger;
  }): Promise<ConversationMemoryContext>;
  read(input: {
    context: ConversationMemoryContext;
    query: string;
    repositoryConfig: RepositoryConfig;
  }): Promise<MemorySearchResult>;
}

export function createConversationMemoryService(options: {
  logger: Logger;
  memoryStore: MemoryStoreAdapter;
  repositoryConfig: RepositoryConfig;
}): ConversationMemoryService {
  return {
    async loadTurnContext(input): Promise<ConversationMemoryContext> {
      const binding = buildBinding({
        agent: input.agent,
        channel: input.channel,
        repositoryConfig: input.repositoryConfig,
      });
      const baselineItems =
        input.trigger.kind === 'trusted_messages'
          ? buildTrustedTurnItems(input.messages)
          : buildDueTaskItems(input.modelInput);
      const readAllowed = shouldAttemptMemoryRead({
        bindingAvailable: binding != null,
        items: baselineItems,
      });
      const writeAllowed = shouldAttemptMemoryWrite({
        allowTriggerKinds: input.repositoryConfig.memory.writes.allowTriggerKinds,
        bindingAvailable: binding != null,
        eligibleMessages: input.messages,
        triggerKind: input.trigger.kind,
      });

      if (!binding || !readAllowed) {
        return {
          baselineItems,
          binding,
          lastSearchId: null,
          promptMemories: [],
          readAllowed,
          writeAllowed,
        };
      }

      try {
        const result = await options.memoryStore.search({
          binding,
          items: baselineItems,
          maxMemories: input.repositoryConfig.memory.retrieval.maxItems,
        });

        return {
          baselineItems,
          binding,
          lastSearchId: result.searchId,
          promptMemories: normalizeRetrievedMemories({
            maxCharsPerItem: input.repositoryConfig.memory.retrieval.maxCharsPerItem,
            maxItems: input.repositoryConfig.memory.retrieval.maxItems,
            memories: result.memories,
          }),
          readAllowed,
          writeAllowed,
        };
      } catch (error) {
        options.logger.warn('conversation_memory.prefetch_failed', {
          agentId: input.agent.id,
          channelId: input.channel.id,
          message: error instanceof Error ? error.message : 'Unknown memory search error.',
          triggerKind: input.trigger.kind,
        });

        return {
          baselineItems,
          binding,
          lastSearchId: null,
          promptMemories: [],
          readAllowed: false,
          writeAllowed,
        };
      }
    },

    async read(input): Promise<MemorySearchResult> {
      const query = input.query.trim();
      if (!input.context.binding || !input.context.readAllowed || query.length === 0) {
        return {
          memories: [],
          searchId: input.context.lastSearchId,
        };
      }

      try {
        const result = await options.memoryStore.search({
          binding: input.context.binding,
          items: [
            ...input.context.baselineItems,
            {
              role: 'user',
              text: query,
            },
          ],
          maxMemories: input.repositoryConfig.memory.retrieval.maxItems,
          previousSearchId: input.context.lastSearchId,
        });

        input.context.lastSearchId = result.searchId;

        return {
          memories: normalizeRetrievedMemories({
            maxCharsPerItem: input.repositoryConfig.memory.retrieval.maxCharsPerItem,
            maxItems: input.repositoryConfig.memory.retrieval.maxItems,
            memories: result.memories,
          }),
          searchId: result.searchId,
        };
      } catch (error) {
        options.logger.warn('conversation_memory.read_failed', {
          message: error instanceof Error ? error.message : 'Unknown memory search error.',
          scopeKey: input.context.binding.scopeKey,
          storeName: input.context.binding.storeName,
        });

        return {
          memories: [],
          searchId: input.context.lastSearchId,
        };
      }
    },

    createWriteCandidate(input): MemoryWriteCandidate {
      const text = input.text.trim();
      if (!input.context.binding || !input.context.writeAllowed) {
        throw new Error('Durable memory writes are not allowed for this turn.');
      }

      if (text.length === 0) {
        throw new Error('Durable memory text must not be empty.');
      }

      if (text.toLowerCase().includes('[credential input redacted]')) {
        throw new Error('Redacted secure input must not be written to durable memory.');
      }

      const allowedCategory = WRITE_POLICY_CATEGORY[input.category];
      if (!options.repositoryConfig.memory.policy.remember.includes(allowedCategory)) {
        throw new Error(`Memory category '${input.category}' is not allowed by repository policy.`);
      }

      return {
        category: input.category,
        text,
      };
    },

    async commitWrites(input): Promise<{ updateIds: string[] }> {
      if (!input.context.binding || !input.context.writeAllowed || input.candidates.length === 0) {
        return { updateIds: [] };
      }

      try {
        return await options.memoryStore.commitWrites({
          binding: input.context.binding,
          candidates: dedupeWriteCandidates(input.candidates),
        });
      } catch (error) {
        options.logger.warn('conversation_memory.commit_failed', {
          message: error instanceof Error ? error.message : 'Unknown memory update error.',
          scopeKey: input.context.binding.scopeKey,
          storeName: input.context.binding.storeName,
        });

        return { updateIds: [] };
      }
    },
  };
}

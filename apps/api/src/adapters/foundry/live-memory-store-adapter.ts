import { AIProjectClient } from '@azure/ai-projects';
import { DefaultAzureCredential } from '@azure/identity';

import type {
  MemorySearchInputItem,
  MemorySearchResult,
  MemoryStoreAdapter,
  MemoryWriteCandidate,
  RetrievedMemory,
} from './types.js';

function isHttpStatus(error: unknown, statusCode: number): boolean {
  return (
    typeof error === 'object' &&
    error != null &&
    'statusCode' in error &&
    (error as { statusCode?: number }).statusCode === statusCode
  );
}

function buildMemoryItems(items: readonly MemorySearchInputItem[]): Record<string, unknown>[] {
  return items
    .filter((item) => item.text.trim().length > 0)
    .map((item) => ({
      content: [
        {
          text: item.text.trim(),
          type: 'input_text',
        },
      ],
      role: item.role,
      type: 'message',
    }));
}

function buildWriteItems(candidates: readonly MemoryWriteCandidate[]): Record<string, unknown>[] {
  return buildMemoryItems([
    {
      role: 'developer',
      text: [
        'Store only durable long-term conversational memory from these validated memory candidates.',
        'Never store credentials, secure inputs, approvals, queue state, active task state, or operational scratch notes.',
      ].join(' '),
    },
    ...candidates.map((candidate) => ({
      role: 'assistant' as const,
      text: `${candidate.category}: ${candidate.text}`,
    })),
  ]);
}

function normalizeRetrievedMemory(memory: {
  content: string;
  kind: string;
  memory_id: string;
}): RetrievedMemory {
  return {
    id: memory.memory_id,
    kind: memory.kind === 'user_profile' ? 'user_profile' : 'chat_summary',
    text: memory.content,
  };
}

function extractUpdateIdFromLocation(location: string | null | undefined): string | null {
  if (!location) {
    return null;
  }

  try {
    const url = new URL(location, 'https://memory-store.local');
    const match = url.pathname.match(/\/updates\/([^/]+)$/i);
    return match?.[1] ?? null;
  } catch {
    const match = location.match(/\/updates\/([^/?]+)/i);
    return match?.[1] ?? null;
  }
}

async function extractUpdateIdFromPoller(poller: {
  serialize(): Promise<string>;
}): Promise<string | null> {
  try {
    const serialized = JSON.parse(await poller.serialize()) as {
      state?: {
        config?: {
          operationLocation?: string;
        };
      };
    };

    return extractUpdateIdFromLocation(serialized.state?.config?.operationLocation);
  } catch {
    return null;
  }
}

export function createLiveMemoryStoreAdapter(options: {
  chatModelDeploymentName: string;
  embeddingModelDeploymentName: string;
  projectEndpoint: string;
}): MemoryStoreAdapter {
  const projectClient = new AIProjectClient(
    options.projectEndpoint,
    new DefaultAzureCredential(),
  );
  const ensuredStores = new Set<string>();

  async function ensureStoreExists(storeName: string): Promise<void> {
    if (ensuredStores.has(storeName)) {
      return;
    }

    try {
      await projectClient.beta.memoryStores.get(storeName);
      ensuredStores.add(storeName);
      return;
    } catch (error) {
      if (!isHttpStatus(error, 404)) {
        throw error;
      }
    }

    try {
      await projectClient.beta.memoryStores.create(storeName, {
        kind: 'default',
        chat_model: options.chatModelDeploymentName,
        embedding_model: options.embeddingModelDeploymentName,
        options: {
          chat_summary_enabled: true,
          user_profile_enabled: true,
        },
      });
    } catch (error) {
      if (!isHttpStatus(error, 409)) {
        throw error;
      }
    }

    ensuredStores.add(storeName);
  }

  return {
    async ensureStore(binding): Promise<void> {
      await ensureStoreExists(binding.storeName);
    },

    async search(input): Promise<MemorySearchResult> {
      await ensureStoreExists(input.binding.storeName);
      const items = buildMemoryItems(input.items);
      if (items.length === 0) {
        return {
          memories: [],
          searchId: null,
        };
      }

      const result = await projectClient.beta.memoryStores.searchMemories(
        input.binding.storeName,
        input.binding.scopeKey,
        {
          ...(input.maxMemories != null
            ? {
                options: {
                  max_memories: input.maxMemories,
                },
              }
            : {}),
          items,
          ...(input.previousSearchId
            ? {
                previousSearchId: input.previousSearchId,
              }
            : {}),
        },
      );

      return {
        memories: result.memories.map((item) => normalizeRetrievedMemory(item.memory_item)),
        searchId: result.search_id ?? null,
      };
    },

    async commitWrites(input): Promise<{ updateIds: string[] }> {
      await ensureStoreExists(input.binding.storeName);
      if (input.candidates.length === 0) {
        return { updateIds: [] };
      }

      const poller = projectClient.beta.memoryStores.updateMemories(
        input.binding.storeName,
        input.binding.scopeKey,
        {
          items: buildWriteItems(input.candidates),
          ...(input.previousUpdateId
            ? {
                previousUpdateId: input.previousUpdateId,
              }
            : {}),
          updateDelayInSecs: 0,
        },
      );
      await poller.poll();
      const updateId = await extractUpdateIdFromPoller(poller);
      const result =
        poller.isDone && poller.result != null
          ? poller.result
          : await poller.pollUntilDone();

      return {
        updateIds:
          updateId != null
            ? [updateId]
            : result.memory_operations.map((operation) => operation.memory_item.memory_id),
      };
    },
  };
}

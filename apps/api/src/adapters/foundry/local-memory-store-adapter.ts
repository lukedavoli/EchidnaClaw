import type {
  MemorySearchResult,
  MemoryStoreAdapter,
  MemoryWriteCandidate,
  RetrievedMemory,
} from './types.js';

type LocalStoredMemory = RetrievedMemory & {
  category: MemoryWriteCandidate['category'];
  updatedAt: string;
};

const CATEGORY_KIND: Record<MemoryWriteCandidate['category'], RetrievedMemory['kind']> = {
  agent_guidance: 'chat_summary',
  durable_fact: 'user_profile',
  preference: 'user_profile',
  recurring_pattern: 'chat_summary',
  standing_instruction: 'user_profile',
};

function createMemoryId(input: {
  category: MemoryWriteCandidate['category'];
  scopeKey: string;
  storeName: string;
}): string {
  return `local-memory:${input.storeName}:${input.scopeKey}:${input.category}`;
}

function tokenize(text: string): string[] {
  return text
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function scoreMemory(memory: LocalStoredMemory, queryTerms: readonly string[]): number {
  if (queryTerms.length === 0) {
    return 0;
  }

  const haystack = memory.text.toLowerCase();
  return queryTerms.reduce(
    (score, term) => (haystack.includes(term) ? score + 1 : score),
    0,
  );
}

function compareMemories(left: LocalStoredMemory, right: LocalStoredMemory): number {
  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt.localeCompare(left.updatedAt);
  }

  return left.category.localeCompare(right.category);
}

export function createLocalMemoryStoreAdapter(): MemoryStoreAdapter {
  const stores = new Map<string, Map<string, Map<MemoryWriteCandidate['category'], LocalStoredMemory>>>();
  let searchCount = 0;
  let updateCount = 0;

  function getScope(input: {
    scopeKey: string;
    storeName: string;
  }): Map<MemoryWriteCandidate['category'], LocalStoredMemory> {
    let store = stores.get(input.storeName);
    if (!store) {
      store = new Map();
      stores.set(input.storeName, store);
    }

    let scope = store.get(input.scopeKey);
    if (!scope) {
      scope = new Map();
      store.set(input.scopeKey, scope);
    }

    return scope;
  }

  return {
    async ensureStore(binding): Promise<void> {
      getScope(binding);
    },

    async search(input): Promise<MemorySearchResult> {
      const scope = getScope(input.binding);
      const memories = Array.from(scope.values()).sort(compareMemories);
      const queryTerms = input.items.flatMap((item) => tokenize(item.text));
      const matched = memories
        .map((memory) => ({
          memory,
          score: scoreMemory(memory, queryTerms),
        }))
        .filter((entry) => queryTerms.length === 0 || entry.score > 0)
        .sort((left, right) => {
          if (left.score !== right.score) {
            return right.score - left.score;
          }

          return compareMemories(left.memory, right.memory);
        })
        .map((entry) => ({
          id: entry.memory.id,
          kind: entry.memory.kind,
          text: entry.memory.text,
        }));

      searchCount += 1;

      return {
        memories:
          (matched.length > 0 ? matched : memories.map(({ id, kind, text }) => ({ id, kind, text })))
            .slice(0, input.maxMemories ?? memories.length),
        searchId: `local-search:${searchCount}`,
      };
    },

    async commitWrites(input): Promise<{ updateIds: string[] }> {
      const scope = getScope(input.binding);
      const updatedAt = new Date().toISOString();

      for (const candidate of input.candidates) {
        scope.set(candidate.category, {
          category: candidate.category,
          id: createMemoryId({
            category: candidate.category,
            scopeKey: input.binding.scopeKey,
            storeName: input.binding.storeName,
          }),
          kind: CATEGORY_KIND[candidate.category],
          text: candidate.text,
          updatedAt,
        });
      }

      updateCount += 1;

      return {
        updateIds: [`local-update:${updateCount}`],
      };
    },
  };
}

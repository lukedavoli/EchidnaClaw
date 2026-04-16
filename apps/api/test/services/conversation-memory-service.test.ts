import { loadRepositoryConfig } from '@echidna-claw/config';
import { createLoggerFactory } from '@echidna-claw/observability';
import {
  createAgent,
  createChannel,
  createInboundMessage,
} from '@echidna-claw/persistence';
import { describe, expect, it, vi } from 'vitest';

import type { MemoryStoreAdapter } from '../../src/adapters/foundry/index.js';
import {
  createConversationMemoryService,
  type ConversationMemoryContext,
} from '../../src/services/runtime/conversation-memory-service.js';

const repositoryConfig = loadRepositoryConfig();
const logger = createLoggerFactory({
  level: 'debug',
  serviceName: 'conversation-memory-service-test',
  sink: () => {},
}).createLogger();

function createService(options: {
  commitWritesImpl?: MemoryStoreAdapter['commitWrites'];
  repositoryConfigOverride?: typeof repositoryConfig;
  searchImpl?: MemoryStoreAdapter['search'];
} = {}) {
  const search = vi.fn(
    options.searchImpl ??
      (async () => ({
        memories: [],
        searchId: null,
      })),
  );
  const commitWrites = vi.fn(
    options.commitWritesImpl ??
      (async () => ({
        updateIds: [],
      })),
  );
  const memoryStore: MemoryStoreAdapter = {
    ensureStore: vi.fn(async () => {}),
    search,
    commitWrites,
  };

  return {
    commitWrites,
    search,
    service: createConversationMemoryService({
      logger,
      memoryStore,
      repositoryConfig: options.repositoryConfigOverride ?? repositoryConfig,
    }),
  };
}

function createTrustedAgentChannel() {
  const agent = createAgent({
    id: 'agt-memory-service',
    primaryChannelId: 'chn-memory-service',
  });
  const channel = createChannel({
    id: 'chn-memory-service',
    agentId: agent.id,
    trustedExternalUserId: 'user-42',
  });

  return {
    agent,
    channel,
  };
}

function createTrustedContext(
  overrides: Partial<ConversationMemoryContext> = {},
): ConversationMemoryContext {
  return {
    baselineItems: [
      {
        role: 'user',
        text: 'Reply with terse status updates.',
      },
    ],
    binding: {
      provider: 'telegram',
      scopeKey: 'telegram-user-42',
      storeName: 'echidna-agent-agt-memory-service',
    },
    lastSearchId: 'search-prefetch',
    promptMemories: [],
    readAllowed: true,
    writeAllowed: true,
    ...overrides,
  };
}

describe('createConversationMemoryService', () => {
  it('prefetches prompt memory for trusted turns and clips duplicate results', async () => {
    const longText = `Remember ${'x'.repeat(repositoryConfig.memory.retrieval.maxCharsPerItem + 20)}`;
    const { agent, channel } = createTrustedAgentChannel();
    const trustedMessage = createInboundMessage({
      agentId: agent.id,
      body: {
        text: 'I prefer terse status updates.',
        artifacts: [],
      },
      channelId: channel.id,
    });
    const ignoredMessage = createInboundMessage({
      agentId: agent.id,
      body: {
        text: 'This message should not reach memory.',
        artifacts: [],
      },
      channelId: channel.id,
      id: 'inm-memory-ignored',
      trusted: false,
    });
    const { search, service } = createService({
      searchImpl: async () => ({
        memories: [
          {
            id: 'mem-1',
            kind: 'user_profile',
            text: 'Prefers terse status updates.',
          },
          {
            id: 'mem-2',
            kind: 'user_profile',
            text: 'Prefers terse status updates.',
          },
          {
            id: 'mem-3',
            kind: 'chat_summary',
            text: longText,
          },
        ],
        searchId: 'search-prefetch',
      }),
    });

    const context = await service.loadTurnContext({
      agent,
      channel,
      messages: [ignoredMessage, trustedMessage],
      modelInput: [],
      repositoryConfig,
      trigger: {
        kind: 'trusted_messages',
        channelId: channel.id,
        inboundMessageIds: [trustedMessage.id],
        readThroughMessageSequence: trustedMessage.sequence,
      },
    });

    expect(search).toHaveBeenCalledOnce();
    expect(search.mock.calls[0]?.[0]).toMatchObject({
      binding: {
        provider: 'telegram',
        scopeKey: 'telegram-user-42',
        storeName: 'echidna-agent-agt-memory-service',
      },
      items: [
        {
          role: 'user',
          text: 'I prefer terse status updates.',
        },
      ],
      maxMemories: repositoryConfig.memory.retrieval.maxItems,
    });
    expect(context.readAllowed).toBe(true);
    expect(context.writeAllowed).toBe(true);
    expect(context.lastSearchId).toBe('search-prefetch');
    expect(context.promptMemories).toHaveLength(2);
    expect(context.promptMemories[0]).toMatchObject({
      id: 'mem-1',
      kind: 'user_profile',
      text: 'Prefers terse status updates.',
    });
    expect(context.promptMemories[1]?.kind).toBe('chat_summary');
    expect(context.promptMemories[1]?.text.endsWith('...')).toBe(true);
    expect(context.promptMemories[1]?.text.length).toBeLessThanOrEqual(
      repositoryConfig.memory.retrieval.maxCharsPerItem + 3,
    );
  });

  it('builds due-task memory lookups from non-system model input only', async () => {
    const { agent, channel } = createTrustedAgentChannel();
    const { search, service } = createService({
      searchImpl: async () => ({
        memories: [],
        searchId: 'search-due-task',
      }),
    });

    const context = await service.loadTurnContext({
      agent,
      channel,
      messages: [],
      modelInput: [
        {
          role: 'developer',
          text: 'Review the deployment reminder.',
        },
        {
          role: 'system',
          text: 'This should not reach memory search.',
        },
        {
          role: 'user',
          text: 'The operator asked for Sydney business hours.',
        },
      ],
      repositoryConfig,
      trigger: {
        kind: 'due_task',
        dueAt: '2026-04-17T01:00:00.000Z',
        taskId: 'tsk-memory-due',
      },
    });

    expect(search).toHaveBeenCalledOnce();
    expect(search.mock.calls[0]?.[0]?.items).toEqual([
      {
        role: 'developer',
        text: 'Review the deployment reminder.',
      },
      {
        role: 'user',
        text: 'The operator asked for Sydney business hours.',
      },
    ]);
    expect(context.readAllowed).toBe(true);
    expect(context.writeAllowed).toBe(false);
  });

  it('chains explicit reads onto the prefetched search cursor', async () => {
    const { agent, channel } = createTrustedAgentChannel();
    const trustedMessage = createInboundMessage({
      agentId: agent.id,
      body: {
        text: 'I prefer terse status updates.',
        artifacts: [],
      },
      channelId: channel.id,
    });
    const responses = [
      {
        memories: [],
        searchId: 'search-prefetch',
      },
      {
        memories: [
          {
            id: 'mem-read-1',
            kind: 'user_profile' as const,
            text: 'Prefers terse status updates.',
          },
        ],
        searchId: 'search-read',
      },
    ];
    let callIndex = 0;
    const { search, service } = createService({
      searchImpl: async () => responses[callIndex++] ?? responses.at(-1)!,
    });

    const context = await service.loadTurnContext({
      agent,
      channel,
      messages: [trustedMessage],
      modelInput: [],
      repositoryConfig,
      trigger: {
        kind: 'trusted_messages',
        channelId: channel.id,
        inboundMessageIds: [trustedMessage.id],
        readThroughMessageSequence: trustedMessage.sequence,
      },
    });
    const result = await service.read({
      context,
      query: 'What do I prefer for status updates?',
      repositoryConfig,
    });

    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[1]?.[0]).toMatchObject({
      previousSearchId: 'search-prefetch',
    });
    expect(search.mock.calls[1]?.[0]?.items.at(-1)).toEqual({
      role: 'user',
      text: 'What do I prefer for status updates?',
    });
    expect(result).toEqual({
      memories: [
        {
          id: 'mem-read-1',
          kind: 'user_profile',
          text: 'Prefers terse status updates.',
        },
      ],
      searchId: 'search-read',
    });
    expect(context.lastSearchId).toBe('search-read');
  });

  it('validates durable memory writes against redaction and repository policy', () => {
    const { service } = createService();
    const context = createTrustedContext();

    expect(
      service.createWriteCandidate({
        category: 'preference',
        context,
        text: '  Reply with terse status updates.  ',
      }),
    ).toEqual({
      category: 'preference',
      text: 'Reply with terse status updates.',
    });
    expect(() =>
      service.createWriteCandidate({
        category: 'preference',
        context,
        text: 'Contains [credential input redacted] and must be rejected.',
      }),
    ).toThrow('Redacted secure input must not be written to durable memory.');

    const restrictedService = createService({
      repositoryConfigOverride: {
        ...repositoryConfig,
        memory: {
          ...repositoryConfig.memory,
          policy: {
            ...repositoryConfig.memory.policy,
            remember: repositoryConfig.memory.policy.remember.filter(
              (category) => category !== 'agent_guidance',
            ),
          },
        },
      },
    }).service;

    expect(() =>
      restrictedService.createWriteCandidate({
        category: 'agent_guidance',
        context,
        text: 'Keep replies short and operational.',
      }),
    ).toThrow("Memory category 'agent_guidance' is not allowed by repository policy.");
  });

  it('deduplicates staged writes before committing them', async () => {
    const { commitWrites, service } = createService({
      commitWritesImpl: async () => ({
        updateIds: ['update-1'],
      }),
    });
    const context = createTrustedContext();

    const result = await service.commitWrites({
      candidates: [
        {
          category: 'preference',
          text: 'Reply with terse status updates.',
        },
        {
          category: 'preference',
          text: 'reply with terse status updates.',
        },
        {
          category: 'durable_fact',
          text: 'The operator works in Sydney.',
        },
      ],
      context,
    });

    expect(commitWrites).toHaveBeenCalledOnce();
    expect(commitWrites.mock.calls[0]?.[0]).toEqual({
      binding: context.binding,
      candidates: [
        {
          category: 'preference',
          text: 'Reply with terse status updates.',
        },
        {
          category: 'durable_fact',
          text: 'The operator works in Sydney.',
        },
      ],
    });
    expect(result).toEqual({
      updateIds: ['update-1'],
    });
  });
});

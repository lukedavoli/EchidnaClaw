import type { HeadTurn } from '@echidna-claw/contracts';
import { loadRepositoryConfig } from '@echidna-claw/config';
import {
  createAgent,
  createChannel,
  createCorrelationMetadata,
  createWorkingContext,
} from '@echidna-claw/persistence';
import { describe, expect, it } from 'vitest';

import { createHeadToolCatalog } from '../../src/services/runtime/head-tool-catalog.js';

function createHeadTurnFixture(): HeadTurn {
  return {
    id: 'hdr_head-tool-catalog',
    recordType: 'head_turn',
    schemaVersion: 1,
    createdAt: '2026-04-14T00:00:00.000Z',
    updatedAt: '2026-04-14T00:00:00.000Z',
    correlation: createCorrelationMetadata({
      headTurnId: 'hdr_head-tool-catalog',
    }),
    agentId: 'agt_persistence',
    workingContextId: 'ctx_persistence',
    state: 'running',
    triggerKind: 'trusted_messages',
    inboundMessageIds: ['inm_persistence'],
    readThroughMessageSequence: 1,
    taskId: null,
    scheduleId: null,
    dueAt: null,
    claimedAt: '2026-04-14T00:00:00.000Z',
    startedAt: '2026-04-14T00:00:00.000Z',
    completedAt: null,
    staleCheckedAt: null,
    episodeLocalDate: '2026-04-14',
    episodeTurnIndex: 1,
    supersededBySequence: null,
    providerConversationId: null,
    providerRunId: null,
    promptProfileVersion: 'head-base-v1',
    completionKind: null,
    failureCode: undefined,
    failureMessage: undefined,
    responseMessageId: null,
  };
}

describe('createHeadToolCatalog', () => {
  it('declares strict-schema required keys for enabled tools', () => {
    const catalog = createHeadToolCatalog({
      activeHeadTurnCount: 1,
      agent: createAgent(),
      channel: createChannel(),
      conversationMemoryService: {
        async commitWrites() {
          return { updateIds: [] };
        },
        createWriteCandidate() {
          throw new Error('unused');
        },
        async loadTurnContext() {
          throw new Error('unused');
        },
        async read() {
          return {
            memories: [],
            searchId: null,
          };
        },
      },
      headTurn: createHeadTurnFixture(),
      memoryContext: {
        baselineItems: [],
        binding: null,
        lastSearchId: null,
        promptMemories: [],
        readAllowed: false,
        writeAllowed: false,
      },
      repositoryConfig: loadRepositoryConfig(),
      scheduleMutationService: {
        async mutate() {
          throw new Error('unused');
        },
      },
      taskQueueService: {
        async activateDeferredTask() {
          throw new Error('unused');
        },
        async enqueueTask() {
          throw new Error('unused');
        },
        async getTaskStatusSnapshot() {
          throw new Error('unused');
        },
        async requestQueuedTaskStart() {
          throw new Error('unused');
        },
      },
      workingContext: createWorkingContext(),
    });

    const schemasByTool = new Map(
      catalog.enabledTools.map((tool) => [tool.name, tool.inputSchema]),
    );

    expect(schemasByTool.get('read_status')).toMatchObject({
      required: ['focus'],
    });
    expect(schemasByTool.get('describe_capabilities')).toMatchObject({
      required: ['detail_level'],
    });
  });
});

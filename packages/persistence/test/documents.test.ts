import { describe, expect, it } from 'vitest';

import {
  createAgent,
  createTask,
  createTaskEnvelope,
  createUsageEvent,
  derivePartitionKey,
  deriveQueryFields,
  fromPersistedRecordDocument,
  toPersistedRecordDocument,
} from '../src/index.js';

describe('persistence document mappers', () => {
  it('derives partition keys by record category', () => {
    const agent = createAgent();
    const task = createTask();
    const usageEvent = createUsageEvent();

    expect(derivePartitionKey(agent)).toBe(agent.id);
    expect(derivePartitionKey(task)).toBe(task.agentId);
    expect(derivePartitionKey(usageEvent)).toBe(usageEvent.agentId);
  });

  it('derives queue-priority query fields for tasks and task envelopes', () => {
    expect(
      deriveQueryFields(createTask({ queue: { lane: 'user_requested', priority: 'urgent' } })),
    ).toEqual({
      dueAtSortValue: '9999-12-31T23:59:59.999Z',
      launchRequestedRank: 0,
      queueLaneRank: 0,
      queuePriorityRank: 0,
    });
    expect(
      deriveQueryFields(createTaskEnvelope({ queue: { lane: 'scheduled', priority: 'low' } })),
    ).toEqual({
      dueAtSortValue: '9999-12-31T23:59:59.999Z',
      launchRequestedRank: 0,
      queueLaneRank: 2,
      queuePriorityRank: 3,
    });
  });

  it('round-trips persisted documents back into strict contract records', () => {
    const task = createTask({
      queue: { lane: 'user_requested', priority: 'high' },
    });

    const persisted = toPersistedRecordDocument(task);
    const roundTripped = fromPersistedRecordDocument(persisted);

    expect(roundTripped).toEqual(task);
  });

  it('ignores Cosmos system metadata when parsing persisted documents', () => {
    const task = createTask({
      queue: { lane: 'user_requested', priority: 'high' },
    });

    const roundTripped = fromPersistedRecordDocument({
      ...toPersistedRecordDocument(task),
      _attachments: 'attachments/',
      _etag: '"0x8DA123"',
      _rid: 'rid',
      _self: 'dbs/db/colls/coll/docs/doc',
      _ts: 1_776_073_200,
    });

    expect(roundTripped).toEqual(task);
  });

  it('rejects persisted documents whose envelope drifts from derived storage fields', () => {
    const task = createTask();
    const persisted = toPersistedRecordDocument(task);

    expect(() =>
      fromPersistedRecordDocument({
        ...persisted,
        partitionKey: 'agt_wrong',
      }),
    ).toThrow(/partition key mismatch/i);

    expect(() =>
      fromPersistedRecordDocument({
        ...persisted,
        query: {
          dueAtSortValue: '2026-04-12T00:00:00.000Z',
          launchRequestedRank: 0,
          queueLaneRank: 0,
          queuePriorityRank: 0,
        },
      }),
    ).toThrow(/query fields mismatch/i);
  });
});

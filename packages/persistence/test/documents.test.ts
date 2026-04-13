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
    expect(deriveQueryFields(createTask({ queue: { priority: 'urgent' } }))).toEqual({
      queuePriorityRank: 0,
    });
    expect(
      deriveQueryFields(createTaskEnvelope({ queue: { priority: 'low' } })),
    ).toEqual({
      queuePriorityRank: 3,
    });
  });

  it('round-trips persisted documents back into strict contract records', () => {
    const task = createTask({
      queue: { priority: 'high' },
    });

    const persisted = toPersistedRecordDocument(task);
    const roundTripped = fromPersistedRecordDocument(persisted);

    expect(roundTripped).toEqual(task);
  });

  it('ignores Cosmos system metadata when parsing persisted documents', () => {
    const task = createTask({
      queue: { priority: 'high' },
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
          queuePriorityRank: 0,
        },
      }),
    ).toThrow(/query fields mismatch/i);
  });
});

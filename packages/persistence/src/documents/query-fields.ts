import { type PlatformRecord, type QueueDescriptor } from '@echidna-claw/contracts';

export interface PersistedQueryFields {
  queuePriorityRank?: number;
}

const queuePriorityRanks: Record<QueueDescriptor['priority'], number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function getQueuePriorityRank(queue: QueueDescriptor): number {
  const rank = queuePriorityRanks[queue.priority];
  if (rank === undefined) {
    throw new Error(`Unsupported queue priority '${queue.priority}'.`);
  }

  return rank;
}

export function deriveQueryFields(record: PlatformRecord): PersistedQueryFields | undefined {
  switch (record.recordType) {
    case 'task':
    case 'task_envelope':
      return {
        queuePriorityRank: getQueuePriorityRank(record.queue),
      };
    default:
      return undefined;
  }
}

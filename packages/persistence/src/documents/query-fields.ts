import { getDueAtSortValue, getQueueLaneRank } from '@echidna-claw/domain';
import { type PlatformRecord, type QueueDescriptor } from '@echidna-claw/contracts';

export interface PersistedQueryFields {
  dueAtSortValue?: string;
  launchRequestedRank?: number;
  queueLaneRank?: number;
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

export function getLaunchRequestedRank(status: 'not_requested' | 'requested' | 'failed'): number {
  return status === 'not_requested' ? 0 : 1;
}

export function deriveQueryFields(record: PlatformRecord): PersistedQueryFields | undefined {
  switch (record.recordType) {
    case 'task':
      return {
        dueAtSortValue: getDueAtSortValue(record.dueAt),
        launchRequestedRank: getLaunchRequestedRank(record.launchState.status),
        queueLaneRank: getQueueLaneRank(record.queue.lane),
        queuePriorityRank: getQueuePriorityRank(record.queue),
      };
    case 'task_envelope':
      return {
        dueAtSortValue: getDueAtSortValue(record.dueAt),
        launchRequestedRank: record.dispatchIdempotencyKey == null ? 0 : 1,
        queueLaneRank: getQueueLaneRank(record.queue.lane),
        queuePriorityRank: getQueuePriorityRank(record.queue),
      };
    default:
      return undefined;
  }
}

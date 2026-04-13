import {
  usageEventSchema,
  type AgentId,
  type UsageEvent,
  type UsageSource,
} from '@echidna-claw/contracts';

import { type StoredRecord } from '../documents/envelope.js';
import { eq, lte, usageEventsContainerName } from './common.js';
import { type PersistedRecordStore } from './store.js';

export interface UsageEventRepository {
  append(event: UsageEvent): Promise<StoredRecord<UsageEvent>>;
  listByAgent(agentId: AgentId, input?: { from?: string; to?: string; limit?: number }): Promise<StoredRecord<UsageEvent>[]>;
  listWindow(input?: {
    from?: string;
    limit?: number;
    model?: UsageEvent['model'];
    source?: UsageSource;
    to?: string;
  }): Promise<StoredRecord<UsageEvent>[]>;
}

export class DefaultUsageEventRepository implements UsageEventRepository {
  constructor(private readonly store: PersistedRecordStore) {}

  async append(event: UsageEvent): Promise<StoredRecord<UsageEvent>> {
    return this.store.create(usageEventSchema.parse(event));
  }

  async listByAgent(
    agentId: AgentId,
    input?: { from?: string; to?: string; limit?: number },
  ): Promise<StoredRecord<UsageEvent>[]> {
    const where = [eq('recordType', 'usage_event'), eq('agentId', agentId)];

    if (input?.from) {
      where.push({
        field: 'occurredAt',
        operator: '>=',
        value: input.from,
      });
    }

    if (input?.to) {
      where.push(lte('occurredAt', input.to));
    }

    return this.store.query({
      containerName: usageEventsContainerName,
      partitionKey: agentId,
      schema: usageEventSchema,
      where,
      orderBy: [{ field: 'occurredAt', direction: 'desc' }],
      ...(input?.limit ? { limit: input.limit } : {}),
    });
  }

  async listWindow(input?: {
    from?: string;
    limit?: number;
    model?: UsageEvent['model'];
    source?: UsageSource;
    to?: string;
  }): Promise<StoredRecord<UsageEvent>[]> {
    const where = [eq('recordType', 'usage_event')];

    if (input?.source) {
      where.push(eq('source', input.source));
    }

    if (input?.model) {
      where.push(eq('model', input.model));
    }

    if (input?.from) {
      where.push({
        field: 'occurredAt',
        operator: '>=',
        value: input.from,
      });
    }

    if (input?.to) {
      where.push(lte('occurredAt', input.to));
    }

    return this.store.query({
      containerName: usageEventsContainerName,
      schema: usageEventSchema,
      where,
      orderBy: [{ field: 'occurredAt', direction: 'desc' }],
      ...(input?.limit ? { limit: input.limit } : {}),
    });
  }
}

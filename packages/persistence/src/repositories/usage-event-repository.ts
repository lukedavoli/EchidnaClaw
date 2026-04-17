import {
  usageEventSchema,
  type AgentId,
  type UsageEvent,
  type UsageEventId,
  type UsageSource,
} from '@echidna-claw/contracts';

import { type StoredRecord } from '../documents/envelope.js';
import { eq, lte, usageEventsContainerName } from './common.js';
import { type PersistedRecordStore } from './store.js';

export interface UsageEventRepository {
  append(event: UsageEvent): Promise<StoredRecord<UsageEvent>>;
  get(agentId: AgentId, usageEventId: UsageEventId): Promise<StoredRecord<UsageEvent> | null>;
  listByAgent(agentId: AgentId, input?: { from?: string; to?: string; limit?: number }): Promise<StoredRecord<UsageEvent>[]>;
  listWindow(input?: {
    agentId?: AgentId;
    analyticsGroup?: UsageEvent['analyticsGroup'];
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

  async get(
    agentId: AgentId,
    usageEventId: UsageEventId,
  ): Promise<StoredRecord<UsageEvent> | null> {
    return this.store.get(usageEventId, agentId, usageEventSchema);
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
    agentId?: AgentId;
    analyticsGroup?: UsageEvent['analyticsGroup'];
    from?: string;
    limit?: number;
    model?: UsageEvent['model'];
    source?: UsageSource;
    to?: string;
  }): Promise<StoredRecord<UsageEvent>[]> {
    const where = [eq('recordType', 'usage_event')];

    if (input?.agentId) {
      where.push(eq('agentId', input.agentId));
    }

    if (input?.source) {
      where.push(eq('source', input.source));
    }

    if (input?.model) {
      where.push(eq('model', input.model));
    }

    if (input?.analyticsGroup) {
      where.push(eq('analyticsGroup', input.analyticsGroup));
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
      ...(input?.agentId ? { partitionKey: input.agentId } : {}),
      schema: usageEventSchema,
      where,
      orderBy: [{ field: 'occurredAt', direction: 'desc' }],
      ...(input?.limit ? { limit: input.limit } : {}),
    });
  }
}

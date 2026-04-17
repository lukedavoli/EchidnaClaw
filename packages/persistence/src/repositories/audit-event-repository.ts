import {
  auditEventSchema,
  type AgentId,
  type AuditEvent,
  type AuditEventCategory,
  type AuditEventOutcome,
  type AuditEventId,
} from '@echidna-claw/contracts';

import { type StoredRecord } from '../documents/envelope.js';
import { auditHistoryContainerName, eq, lte, gte } from './common.js';
import { type PersistedRecordStore } from './store.js';

export interface AuditEventRepository {
  append(event: AuditEvent): Promise<StoredRecord<AuditEvent>>;
  get(agentId: AgentId, auditEventId: AuditEventId): Promise<StoredRecord<AuditEvent> | null>;
  listByAgent(
    agentId: AgentId,
    input?: {
      category?: AuditEventCategory;
      from?: string;
      limit?: number;
      outcome?: AuditEventOutcome;
      to?: string;
    },
  ): Promise<StoredRecord<AuditEvent>[]>;
  listWindow(input?: {
    agentId?: AgentId;
    category?: AuditEventCategory;
    from?: string;
    limit?: number;
    outcome?: AuditEventOutcome;
    to?: string;
  }): Promise<StoredRecord<AuditEvent>[]>;
}

export class DefaultAuditEventRepository implements AuditEventRepository {
  constructor(private readonly store: PersistedRecordStore) {}

  async append(event: AuditEvent): Promise<StoredRecord<AuditEvent>> {
    return this.store.create(auditEventSchema.parse(event));
  }

  async get(
    agentId: AgentId,
    auditEventId: AuditEventId,
  ): Promise<StoredRecord<AuditEvent> | null> {
    return this.store.get(auditEventId, agentId, auditEventSchema);
  }

  async listByAgent(
    agentId: AgentId,
    input?: {
      category?: AuditEventCategory;
      from?: string;
      limit?: number;
      outcome?: AuditEventOutcome;
      to?: string;
    },
  ): Promise<StoredRecord<AuditEvent>[]> {
    return this.listWindow({
      ...input,
      agentId,
    });
  }

  async listWindow(input?: {
    agentId?: AgentId;
    category?: AuditEventCategory;
    from?: string;
    limit?: number;
    outcome?: AuditEventOutcome;
    to?: string;
  }): Promise<StoredRecord<AuditEvent>[]> {
    const where = [eq('recordType', 'audit_event')];

    if (input?.agentId) {
      where.push(eq('agentId', input.agentId));
    }

    if (input?.category) {
      where.push(eq('category', input.category));
    }

    if (input?.outcome) {
      where.push(eq('outcome', input.outcome));
    }

    if (input?.from) {
      where.push(gte('occurredAt', input.from));
    }

    if (input?.to) {
      where.push(lte('occurredAt', input.to));
    }

    return this.store.query({
      containerName: auditHistoryContainerName,
      ...(input?.agentId ? { partitionKey: input.agentId } : {}),
      schema: auditEventSchema,
      where,
      orderBy: [{ field: 'occurredAt', direction: 'desc' }],
      ...(input?.limit ? { limit: input.limit } : {}),
    });
  }
}

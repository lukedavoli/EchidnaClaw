import {
  idempotencyRecordSchema,
  type AgentId,
  type IdempotencyRecord,
  type IdempotencyRecordId,
} from '@echidna-claw/contracts';

import { type StoredRecord } from '../documents/envelope.js';
import { eq, operationalContainerName } from './common.js';
import { type PersistedRecordStore } from './store.js';

export interface IdempotencyRepository {
  reserve(record: IdempotencyRecord): Promise<StoredRecord<IdempotencyRecord>>;
  get(agentId: AgentId, idempotencyRecordId: IdempotencyRecordId): Promise<StoredRecord<IdempotencyRecord> | null>;
  getByScopeAndKey(
    agentId: AgentId,
    scope: string,
    key: string,
  ): Promise<StoredRecord<IdempotencyRecord> | null>;
  complete(record: IdempotencyRecord, expectedEtag: string): Promise<StoredRecord<IdempotencyRecord>>;
  expire(record: IdempotencyRecord, expectedEtag: string): Promise<StoredRecord<IdempotencyRecord>>;
}

export class DefaultIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly store: PersistedRecordStore) {}

  async reserve(record: IdempotencyRecord): Promise<StoredRecord<IdempotencyRecord>> {
    return this.store.create(idempotencyRecordSchema.parse(record));
  }

  async get(
    agentId: AgentId,
    idempotencyRecordId: IdempotencyRecordId,
  ): Promise<StoredRecord<IdempotencyRecord> | null> {
    return this.store.get(idempotencyRecordId, agentId, idempotencyRecordSchema);
  }

  async getByScopeAndKey(
    agentId: AgentId,
    scope: string,
    key: string,
  ): Promise<StoredRecord<IdempotencyRecord> | null> {
    const results = await this.store.query({
      containerName: operationalContainerName,
      partitionKey: agentId,
      schema: idempotencyRecordSchema,
      where: [eq('recordType', 'idempotency_record'), eq('scope', scope), eq('key', key)],
      limit: 1,
    });

    return results[0] ?? null;
  }

  async complete(
    record: IdempotencyRecord,
    expectedEtag: string,
  ): Promise<StoredRecord<IdempotencyRecord>> {
    return this.store.replace(idempotencyRecordSchema.parse(record), expectedEtag);
  }

  async expire(
    record: IdempotencyRecord,
    expectedEtag: string,
  ): Promise<StoredRecord<IdempotencyRecord>> {
    return this.store.replace(idempotencyRecordSchema.parse(record), expectedEtag);
  }
}

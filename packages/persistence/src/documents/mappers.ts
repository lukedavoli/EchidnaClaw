import { platformRecordSchema, type PlatformRecord } from '@echidna-claw/contracts';
import { z } from 'zod';

import { type PersistedRecordDocument, type StoredRecord } from './envelope.js';
import { derivePartitionKey } from './partition-keys.js';
import { deriveQueryFields, type PersistedQueryFields } from './query-fields.js';

type PersistedEnvelope = {
  partitionKey: string;
  query?: PersistedQueryFields;
  _etag?: string;
};

function normalizeQueryFields(query: PersistedQueryFields | undefined): PersistedQueryFields | undefined {
  if (!query) {
    return undefined;
  }

  const entries = Object.entries(query).filter(([, value]) => value !== undefined);
  return entries.length > 0 ? (Object.fromEntries(entries) as PersistedQueryFields) : undefined;
}

function assertEnvelope(record: PlatformRecord, envelope: PersistedEnvelope): void {
  const expectedPartitionKey = derivePartitionKey(record);
  if (envelope.partitionKey !== expectedPartitionKey) {
    throw new Error(
      `Persisted partition key mismatch for ${record.recordType}:${record.id}. Expected '${expectedPartitionKey}' but received '${envelope.partitionKey}'.`,
    );
  }

  const expectedQueryFields = normalizeQueryFields(deriveQueryFields(record));
  const actualQueryFields = normalizeQueryFields(envelope.query);

  if (JSON.stringify(expectedQueryFields ?? null) !== JSON.stringify(actualQueryFields ?? null)) {
    throw new Error(
      `Persisted query fields mismatch for ${record.recordType}:${record.id}. Expected ${JSON.stringify(expectedQueryFields ?? null)} but received ${JSON.stringify(actualQueryFields ?? null)}.`,
    );
  }
}

export function stripPersistenceEnvelope(
  document: Record<string, unknown> & PersistedEnvelope,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(document).filter(
      ([key]) => !key.startsWith('_') && key !== 'partitionKey' && key !== 'query',
    ),
  );
}

export function toPersistedRecordDocument<TRecord extends PlatformRecord>(
  record: TRecord,
): PersistedRecordDocument<TRecord> {
  const partitionKey = derivePartitionKey(record);
  const query = normalizeQueryFields(deriveQueryFields(record));

  return query ? { ...record, partitionKey, query } : { ...record, partitionKey };
}

export function fromPersistedRecordDocument(
  document: Record<string, unknown> & PersistedEnvelope,
): PlatformRecord {
  if (typeof document.partitionKey !== 'string' || document.partitionKey.length === 0) {
    throw new Error('Persisted records must include a partitionKey.');
  }

  const record = platformRecordSchema.parse(stripPersistenceEnvelope(document));
  assertEnvelope(record, document);
  return record;
}

export function parsePersistedRecordDocument<TRecord extends PlatformRecord>(
  document: Record<string, unknown> & PersistedEnvelope,
  schema: z.ZodType<TRecord, z.ZodTypeDef, unknown>,
): TRecord {
  if (typeof document.partitionKey !== 'string' || document.partitionKey.length === 0) {
    throw new Error('Persisted records must include a partitionKey.');
  }

  const record = schema.parse(stripPersistenceEnvelope(document));
  assertEnvelope(record, document);
  return record;
}

export function toStoredRecord<TRecord extends PlatformRecord>(
  document: Record<string, unknown> & PersistedEnvelope,
  etag: string,
  schema: z.ZodType<TRecord, z.ZodTypeDef, unknown>,
): StoredRecord<TRecord> {
  return {
    value: parsePersistedRecordDocument(document, schema),
    etag,
  };
}

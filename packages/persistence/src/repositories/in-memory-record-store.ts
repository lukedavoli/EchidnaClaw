import { type PlatformRecord } from '@echidna-claw/contracts';
import { z } from 'zod';

import { type ContainerName } from '../documents/container-names.js';
import { type PersistedRecordDocument, type StoredRecord } from '../documents/envelope.js';
import { toPersistedRecordDocument, toStoredRecord } from '../documents/mappers.js';
import { getContainerNameForRecord } from '../documents/partition-keys.js';
import {
  DuplicateRecordError,
  InvalidBatchOperationError,
  OptimisticConcurrencyError,
  RecordNotFoundError,
} from './errors.js';
import {
  type BatchOperation,
  type PersistedRecordStore,
  type QueryCondition,
  type QueryOptions,
  type QueryOrder,
  type QueryValue,
} from './store.js';

type StoredState = {
  document: PersistedRecordDocument;
  etag: string;
};

function getStorageKey(partitionKey: string, id: string): string {
  return `${partitionKey}:${id}`;
}

function getValueByPath(document: Record<string, unknown>, path: string): QueryValue | undefined {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current && typeof current === 'object' && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }

    return undefined;
  }, document) as QueryValue | undefined;
}

function compareValues(left: QueryValue | undefined, right: QueryValue | undefined): number {
  if (left === right) {
    return 0;
  }

  if (left == null) {
    return 1;
  }

  if (right == null) {
    return -1;
  }

  return left < right ? -1 : 1;
}

function matchesCondition(document: Record<string, unknown>, condition: QueryCondition): boolean {
  const actual = getValueByPath(document, condition.field);

  switch (condition.operator) {
    case '=':
      return actual === condition.value;
    case '<':
      return compareValues(actual, condition.value) < 0;
    case '<=':
      return compareValues(actual, condition.value) <= 0;
    case '>':
      return compareValues(actual, condition.value) > 0;
    case '>=':
      return compareValues(actual, condition.value) >= 0;
    case 'in':
      return condition.value.includes(actual ?? null);
  }
}

function compareOrder(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  orderBy: readonly QueryOrder[],
): number {
  for (const order of orderBy) {
    const comparison = compareValues(getValueByPath(left, order.field), getValueByPath(right, order.field));
    if (comparison !== 0) {
      return order.direction === 'asc' ? comparison : comparison * -1;
    }
  }

  return 0;
}

export class InMemoryRecordStore implements PersistedRecordStore {
  private readonly containers = new Map<ContainerName, Map<string, StoredState>>();

  private etagCounter = 0;

  private getContainer(containerName: ContainerName): Map<string, StoredState> {
    const existing = this.containers.get(containerName);
    if (existing) {
      return existing;
    }

    const created = new Map<string, StoredState>();
    this.containers.set(containerName, created);
    return created;
  }

  private nextEtag(): string {
    this.etagCounter += 1;
    return `etag-${this.etagCounter}`;
  }

  async create<TRecord extends PlatformRecord>(record: TRecord): Promise<StoredRecord<TRecord>> {
    const containerName = getContainerNameForRecord(record);
    const container = this.getContainer(containerName);
    const document = toPersistedRecordDocument(record);
    const storageKey = getStorageKey(document.partitionKey, document.id);

    if (container.has(storageKey)) {
      throw new DuplicateRecordError(
        `A ${record.recordType} record with id '${record.id}' already exists in partition '${document.partitionKey}'.`,
      );
    }

    const etag = this.nextEtag();
    container.set(storageKey, { document, etag });
    return {
      value: record,
      etag,
    };
  }

  async get<TRecord extends PlatformRecord>(
    id: string,
    partitionKey: string,
    schema: z.ZodType<TRecord, z.ZodTypeDef, unknown>,
  ): Promise<StoredRecord<TRecord> | null> {
    const storageKey = getStorageKey(partitionKey, id);

    for (const container of this.containers.values()) {
      const stored = container.get(storageKey);
      if (stored) {
        return toStoredRecord(stored.document, stored.etag, schema);
      }
    }

    return null;
  }

  async replace<TRecord extends PlatformRecord>(
    record: TRecord,
    expectedEtag: string,
  ): Promise<StoredRecord<TRecord>> {
    const containerName = getContainerNameForRecord(record);
    const container = this.getContainer(containerName);
    const document = toPersistedRecordDocument(record);
    const storageKey = getStorageKey(document.partitionKey, document.id);
    const existing = container.get(storageKey);

    if (!existing) {
      throw new RecordNotFoundError(
        `Cannot replace ${record.recordType}:${record.id} because it does not exist.`,
      );
    }

    if (existing.etag !== expectedEtag) {
      throw new OptimisticConcurrencyError(
        `Expected ETag '${expectedEtag}' for ${record.recordType}:${record.id} but found '${existing.etag}'.`,
      );
    }

    const etag = this.nextEtag();
    container.set(storageKey, { document, etag });
    return {
      value: record,
      etag,
    };
  }

  async query<TRecord extends PlatformRecord>(options: QueryOptions<TRecord>): Promise<StoredRecord<TRecord>[]> {
    const container = this.getContainer(options.containerName);
    let matches = Array.from(container.values()).filter((stored) => {
      if (options.partitionKey && stored.document.partitionKey !== options.partitionKey) {
        return false;
      }

      return (options.where ?? []).every((condition) => matchesCondition(stored.document, condition));
    });

    if (options.orderBy && options.orderBy.length > 0) {
      matches = matches.sort((left, right) =>
        compareOrder(left.document, right.document, options.orderBy ?? []),
      );
    }

    if (typeof options.limit === 'number') {
      matches = matches.slice(0, options.limit);
    }

    return matches.map((stored) => toStoredRecord(stored.document, stored.etag, options.schema));
  }

  async batch(
    partitionKey: string,
    operations: readonly BatchOperation[],
  ): Promise<StoredRecord<PlatformRecord>[]> {
    if (operations.length === 0) {
      return [];
    }

    const firstOperation = operations[0];
    if (!firstOperation) {
      return [];
    }

    const containerName = getContainerNameForRecord(firstOperation.record);
    const container = this.getContainer(containerName);
    const staged = new Map(container);
    const results: StoredRecord<PlatformRecord>[] = [];

    for (const operation of operations) {
      const operationContainerName = getContainerNameForRecord(operation.record);
      if (operationContainerName !== containerName) {
        throw new InvalidBatchOperationError(
          `Transactional batches cannot span multiple containers: '${containerName}' and '${operationContainerName}'.`,
        );
      }

      const document = toPersistedRecordDocument(operation.record);
      if (document.partitionKey !== partitionKey) {
        throw new InvalidBatchOperationError(
          `Transactional batches must stay within partition '${partitionKey}', but received '${document.partitionKey}'.`,
        );
      }

      const storageKey = getStorageKey(document.partitionKey, document.id);

      if (operation.kind === 'create') {
        if (staged.has(storageKey)) {
          throw new DuplicateRecordError(
            `Cannot create ${operation.record.recordType}:${operation.record.id}; it already exists in the batch partition.`,
          );
        }

        const etag = this.nextEtag();
        staged.set(storageKey, { document, etag });
        results.push({
          value: operation.record,
          etag,
        });
        continue;
      }

      const existing = staged.get(storageKey);
      if (!existing) {
        throw new RecordNotFoundError(
          `Cannot replace ${operation.record.recordType}:${operation.record.id}; it does not exist in the batch partition.`,
        );
      }

      if (existing.etag !== operation.expectedEtag) {
        throw new OptimisticConcurrencyError(
          `Expected ETag '${operation.expectedEtag}' for ${operation.record.recordType}:${operation.record.id} but found '${existing.etag}'.`,
        );
      }

      const etag = this.nextEtag();
      staged.set(storageKey, { document, etag });
      results.push({
        value: operation.record,
        etag,
      });
    }

    this.containers.set(containerName, staged);
    return results;
  }
}

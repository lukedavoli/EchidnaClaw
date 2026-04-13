import { type Container, CosmosClient, type SqlQuerySpec } from '@azure/cosmos';
import { type PlatformRecord } from '@echidna-claw/contracts';
import { z } from 'zod';

import {
  AGENT_STATE_CONTAINER_NAME,
  USAGE_EVENTS_CONTAINER_NAME,
  type ContainerName,
} from '../documents/container-names.js';
import { type StoredRecord } from '../documents/envelope.js';
import { toPersistedRecordDocument, toStoredRecord } from '../documents/mappers.js';
import { getContainerNameForRecord } from '../documents/partition-keys.js';
import {
  DuplicateRecordError,
  OptimisticConcurrencyError,
  RecordConflictError,
  RecordNotFoundError,
} from './errors.js';
import {
  type BatchOperation,
  type PersistedRecordStore,
  type QueryCondition,
  type QueryOptions,
  type QueryOrder,
} from './store.js';

function getStatusCode(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    return typeof statusCode === 'number' ? statusCode : undefined;
  }

  return undefined;
}

function mapCosmosError(error: unknown): Error {
  switch (getStatusCode(error)) {
    case 404:
      return new RecordNotFoundError('The requested record was not found.');
    case 409:
      return new DuplicateRecordError('The requested record already exists.');
    case 412:
      return new OptimisticConcurrencyError('The requested write used a stale ETag.');
    default:
      return error instanceof Error
        ? error
        : new RecordConflictError('An unknown Cosmos DB error occurred.');
  }
}

function getSqlPath(field: string): string {
  return `c.${field}`;
}

function buildWhere(where: readonly QueryCondition[] | undefined): {
  clause: string;
  parameters: NonNullable<SqlQuerySpec['parameters']>;
} {
  if (!where || where.length === 0) {
    return {
      clause: '',
      parameters: [],
    };
  }

  const parameters: NonNullable<SqlQuerySpec['parameters']> = [];
  const predicates = where.map((condition, index) => {
    const parameterName = `@p${index}`;
    const sqlPath = getSqlPath(condition.field);

    if (condition.operator === '=') {
      if (condition.value === null) {
        return `IS_NULL(${sqlPath})`;
      }

      parameters.push({
        name: parameterName,
        value: condition.value,
      });
      return `${sqlPath} = ${parameterName}`;
    }

    if (condition.operator === 'in') {
      parameters.push({
        name: parameterName,
        value: condition.value,
      });
      return `ARRAY_CONTAINS(${parameterName}, ${sqlPath})`;
    }

    parameters.push({
      name: parameterName,
      value: condition.value,
    });
    return `${sqlPath} ${condition.operator} ${parameterName}`;
  });

  return {
    clause: ` WHERE ${predicates.join(' AND ')}`,
    parameters,
  };
}

function buildOrderBy(orderBy: readonly QueryOrder[] | undefined): string {
  if (!orderBy || orderBy.length === 0) {
    return '';
  }

  const fragments = orderBy.map(
    (order) => `${getSqlPath(order.field)} ${order.direction === 'asc' ? 'ASC' : 'DESC'}`,
  );
  return ` ORDER BY ${fragments.join(', ')}`;
}

function getResponseEtag(response: { etag?: string; resource?: Record<string, unknown> }): string {
  const candidate = response.etag ?? response.resource?._etag;
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new Error('Cosmos DB did not return an ETag for the persisted record.');
  }

  return candidate;
}

export interface CosmosRecordStoreOptions {
  client: CosmosClient;
  databaseName: string;
  agentStateContainerName?: string;
  usageEventsContainerName?: string;
}

export class CosmosRecordStore implements PersistedRecordStore {
  private readonly containers: Record<ContainerName, Container>;

  constructor(options: CosmosRecordStoreOptions) {
    const database = options.client.database(options.databaseName);

    this.containers = {
      [AGENT_STATE_CONTAINER_NAME]: database.container(
        options.agentStateContainerName ?? AGENT_STATE_CONTAINER_NAME,
      ),
      [USAGE_EVENTS_CONTAINER_NAME]: database.container(
        options.usageEventsContainerName ?? USAGE_EVENTS_CONTAINER_NAME,
      ),
    };
  }

  private getContainer(containerName: ContainerName): Container {
    return this.containers[containerName];
  }

  async create<TRecord extends PlatformRecord>(record: TRecord): Promise<StoredRecord<TRecord>> {
    const document = toPersistedRecordDocument(record);
    const container = this.getContainer(getContainerNameForRecord(record));

    try {
      const response = (await container.items.create(
        document as never,
      )) as unknown as {
        etag?: string;
        resource?: Record<string, unknown>;
      };

      return {
        value: record,
        etag: getResponseEtag(response),
      };
    } catch (error) {
      throw mapCosmosError(error);
    }
  }

  async get<TRecord extends PlatformRecord>(
    id: string,
    partitionKey: string,
    schema: z.ZodType<TRecord, z.ZodTypeDef, unknown>,
  ): Promise<StoredRecord<TRecord> | null> {
    for (const container of Object.values(this.containers)) {
      try {
        const response = (await container.item(id, partitionKey).read()) as {
          etag?: string;
          resource?: Record<string, unknown>;
        };

        if (!response.resource) {
          return null;
        }

        return toStoredRecord(
          response.resource as Record<string, unknown> & { partitionKey: string },
          getResponseEtag(response),
          schema,
        );
      } catch (error) {
        if (getStatusCode(error) === 404) {
          continue;
        }

        throw mapCosmosError(error);
      }
    }

    return null;
  }

  async replace<TRecord extends PlatformRecord>(
    record: TRecord,
    expectedEtag: string,
  ): Promise<StoredRecord<TRecord>> {
    const document = toPersistedRecordDocument(record);
    const container = this.getContainer(getContainerNameForRecord(record));

    try {
      const response = (await container
        .item(record.id, document.partitionKey)
        .replace(document as never, {
          accessCondition: {
            type: 'IfMatch',
            condition: expectedEtag,
          },
        } as never)) as unknown as {
        etag?: string;
        resource?: Record<string, unknown>;
      };

      return {
        value: record,
        etag: getResponseEtag(response),
      };
    } catch (error) {
      throw mapCosmosError(error);
    }
  }

  async query<TRecord extends PlatformRecord>(options: QueryOptions<TRecord>): Promise<StoredRecord<TRecord>[]> {
    const container = this.getContainer(options.containerName);
    const { clause, parameters } = buildWhere(options.where);
    const orderBy = buildOrderBy(options.orderBy);

    const querySpec: SqlQuerySpec = {
      query: `SELECT * FROM c${clause}${orderBy}`,
      ...(parameters.length > 0 ? { parameters } : {}),
    };

    try {
      const iterator = container.items.query(
        querySpec,
        {
          ...(options.partitionKey ? { partitionKey: options.partitionKey } : {}),
          ...(options.limit ? { maxItemCount: options.limit } : {}),
        } as never,
      );
      const response = (await iterator.fetchAll()) as {
        resources: Array<Record<string, unknown> & { partitionKey: string }>;
      };

      return response.resources.map((resource) =>
        toStoredRecord(resource, String(resource._etag ?? ''), options.schema),
      );
    } catch (error) {
      throw mapCosmosError(error);
    }
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
    const transactionalBatchOperations = operations.map((operation) => {
      const document = toPersistedRecordDocument(operation.record);

      if (document.partitionKey !== partitionKey) {
        throw new RecordConflictError(
          `Transactional batches must remain within partition '${partitionKey}'.`,
        );
      }

      if (operation.kind === 'create') {
        return {
          operationType: 'Create',
          resourceBody: document,
        };
      }

      return {
        operationType: 'Replace',
        id: operation.record.id,
        ifMatch: operation.expectedEtag,
        resourceBody: document,
      };
    });

    try {
      const batchCapableItems = container.items as unknown as {
        batch: (
          operations: unknown[],
          partitionKey: string,
        ) => Promise<{
          result?: Array<{
            statusCode: number;
            eTag?: string;
            resourceBody?: Record<string, unknown> & { partitionKey: string };
          }>;
        }>;
      };

      const response = await batchCapableItems.batch(
        transactionalBatchOperations,
        partitionKey,
      );

      const results = response.result ?? [];
      const failure = results.find((result) => result.statusCode >= 400);
      if (failure) {
        throw mapCosmosError({ statusCode: failure.statusCode });
      }

      return results.map((result, index) => {
        const operation = operations[index];
        if (!operation) {
          throw new Error('Cosmos transactional batch response did not align with the request.');
        }

        return {
          value: operation.record,
          etag: result.eTag ?? String(result.resourceBody?._etag ?? ''),
        };
      });
    } catch (error) {
      throw mapCosmosError(error);
    }
  }
}

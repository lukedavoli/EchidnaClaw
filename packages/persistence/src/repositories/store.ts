import { type PlatformRecord } from '@echidna-claw/contracts';
import { z } from 'zod';

import { type ContainerName } from '../documents/container-names.js';
import { type StoredRecord } from '../documents/envelope.js';

export type QueryValue = string | number | boolean | null;

export type QueryCondition =
  | {
      field: string;
      operator: '=';
      value: QueryValue;
    }
  | {
      field: string;
      operator: '<';
      value: Exclude<QueryValue, boolean>;
    }
  | {
      field: string;
      operator: '<=';
      value: Exclude<QueryValue, boolean>;
    }
  | {
      field: string;
      operator: '>';
      value: Exclude<QueryValue, boolean>;
    }
  | {
      field: string;
      operator: '>=';
      value: Exclude<QueryValue, boolean>;
    }
  | {
      field: string;
      operator: 'in';
      value: readonly QueryValue[];
    };

export interface QueryOrder {
  field: string;
  direction: 'asc' | 'desc';
}

export interface QueryOptions<TRecord extends PlatformRecord> {
  containerName: ContainerName;
  schema: z.ZodType<TRecord, z.ZodTypeDef, unknown>;
  partitionKey?: string;
  where?: readonly QueryCondition[];
  orderBy?: readonly QueryOrder[];
  limit?: number;
}

export type BatchOperation =
  | {
      kind: 'create';
      record: PlatformRecord;
    }
  | {
      kind: 'replace';
      record: PlatformRecord;
      expectedEtag: string;
    };

export interface PersistedRecordStore {
  create<TRecord extends PlatformRecord>(record: TRecord): Promise<StoredRecord<TRecord>>;
  get<TRecord extends PlatformRecord>(
    id: string,
    partitionKey: string,
    schema: z.ZodType<TRecord, z.ZodTypeDef, unknown>,
  ): Promise<StoredRecord<TRecord> | null>;
  replace<TRecord extends PlatformRecord>(
    record: TRecord,
    expectedEtag: string,
  ): Promise<StoredRecord<TRecord>>;
  query<TRecord extends PlatformRecord>(options: QueryOptions<TRecord>): Promise<StoredRecord<TRecord>[]>;
  batch(
    partitionKey: string,
    operations: readonly BatchOperation[],
  ): Promise<StoredRecord<PlatformRecord>[]>;
}

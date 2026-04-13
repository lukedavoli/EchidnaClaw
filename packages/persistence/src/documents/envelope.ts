import { type PlatformRecord } from '@echidna-claw/contracts';

import { type PersistedQueryFields } from './query-fields.js';

export type PersistedRecordDocument<TRecord extends PlatformRecord = PlatformRecord> = TRecord & {
  partitionKey: string;
  query?: PersistedQueryFields;
};

export interface StoredRecord<TRecord extends PlatformRecord> {
  value: TRecord;
  etag: string;
}

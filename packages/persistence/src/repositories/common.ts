import { type PlatformRecord } from '@echidna-claw/contracts';

import {
  AGENT_STATE_CONTAINER_NAME,
  USAGE_EVENTS_CONTAINER_NAME,
} from '../documents/container-names.js';
import { type StoredRecord } from '../documents/envelope.js';
import { RecordNotFoundError } from './errors.js';
import { type QueryCondition, type QueryValue } from './store.js';

export const OPEN_TASK_STATES = ['queued', 'running', 'waiting_for_user', 'deferred'] as const;
export const ACTIVE_HEAD_TURN_STATES = ['queued', 'running'] as const;
export const ACTIVE_HANDS_RUN_STATES = ['queued', 'running'] as const;

export function eq(field: string, value: QueryValue): QueryCondition {
  return {
    field,
    operator: '=',
    value,
  };
}

export function lte(field: string, value: Exclude<QueryValue, boolean>): QueryCondition {
  return {
    field,
    operator: '<=',
    value,
  };
}

export function gte(field: string, value: Exclude<QueryValue, boolean>): QueryCondition {
  return {
    field,
    operator: '>=',
    value,
  };
}

export function inList(field: string, value: readonly QueryValue[]): QueryCondition {
  return {
    field,
    operator: 'in',
    value,
  };
}

export async function getRequiredRecord<TRecord extends PlatformRecord>(
  load: Promise<StoredRecord<TRecord> | null>,
  description: string,
): Promise<StoredRecord<TRecord>> {
  const record = await load;
  if (!record) {
    throw new RecordNotFoundError(`${description} was not found.`);
  }

  return record;
}

export function assertSameAgent(
  agentId: string,
  records: ReadonlyArray<{ id?: string; recordType: string; agentId: string }>,
): void {
  for (const record of records) {
    if (record.agentId !== agentId) {
      throw new Error(
        `Expected ${record.recordType}:${record.id ?? '<unknown>'} to belong to agent '${agentId}', received '${record.agentId}'.`,
      );
    }
  }
}

export const operationalContainerName = AGENT_STATE_CONTAINER_NAME;
export const usageEventsContainerName = USAGE_EVENTS_CONTAINER_NAME;

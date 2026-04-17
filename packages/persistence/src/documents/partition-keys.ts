import { type PlatformRecord } from '@echidna-claw/contracts';

import {
  AGENT_STATE_CONTAINER_NAME,
  AUDIT_HISTORY_CONTAINER_NAME,
  USAGE_EVENTS_CONTAINER_NAME,
  type ContainerName,
} from './container-names.js';

export function getContainerNameForRecordType(recordType: PlatformRecord['recordType']): ContainerName {
  switch (recordType) {
    case 'audit_event':
      return AUDIT_HISTORY_CONTAINER_NAME;
    case 'usage_event':
      return USAGE_EVENTS_CONTAINER_NAME;
    default:
      return AGENT_STATE_CONTAINER_NAME;
  }
}

export function getContainerNameForRecord(record: PlatformRecord): ContainerName {
  return getContainerNameForRecordType(record.recordType);
}

export function derivePartitionKey(record: PlatformRecord): string {
  switch (record.recordType) {
    case 'agent':
      return record.id;
    default:
      return record.agentId;
  }
}

import { type PlatformRecord } from '@echidna-claw/contracts';

import {
  AGENT_STATE_CONTAINER_NAME,
  USAGE_EVENTS_CONTAINER_NAME,
  type ContainerName,
} from './container-names.js';

export function getContainerNameForRecordType(recordType: PlatformRecord['recordType']): ContainerName {
  return recordType === 'usage_event' ? USAGE_EVENTS_CONTAINER_NAME : AGENT_STATE_CONTAINER_NAME;
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

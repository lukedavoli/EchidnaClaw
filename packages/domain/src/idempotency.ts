import { createHash } from 'node:crypto';

import {
  type AgentId,
  type ExternalReference,
  type HandsRunId,
  type SandboxSessionId,
  type ScheduleId,
} from '@echidna-claw/contracts';

function normalizePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function createKey(prefix: string, parts: readonly string[]): string {
  const normalizedParts = parts.map((part) => normalizePart(part) || 'x');
  return `${prefix}_${normalizedParts.join('-')}`;
}

function createDeterministicIdentifier(prefix: string, source: string): string {
  return `${prefix}_${createHash('sha256').update(source).digest('hex').slice(0, 24)}`;
}

export function createInboundMessageIdempotencyKey(agentId: AgentId, externalUpdateId: string): string {
  return createKey('idem', [agentId, externalUpdateId]);
}

export function createTaskCreationIdempotencyKey(
  agentId: AgentId,
  requestedOutcome: string,
  dueAt?: string | null,
  taskType = 'task',
  sourceId = 'direct',
): string {
  return createKey('idem', [agentId, taskType, sourceId, requestedOutcome, dueAt ?? 'immediate']);
}

export function createTaskMergeKey(input: {
  agentId: AgentId;
  dueAt?: string | null;
  externalReferences?: readonly ExternalReference[];
  requestedByKind: 'user' | 'schedule' | 'system';
  requestedOutcome: string;
  taskType: string;
}): string {
  const primaryReferences = (input.externalReferences ?? [])
    .map((reference) => `${reference.type}:${reference.reference}`)
    .sort()
    .slice(0, 3);

  return createKey('merge', [
    input.agentId,
    input.taskType,
    input.requestedByKind,
    input.requestedOutcome,
    input.dueAt ?? 'immediate',
    ...primaryReferences,
  ]);
}

export function createApprovalIdempotencyKey(taskId: string, approvalSummary: string): string {
  return createKey('idem', [taskId, approvalSummary]);
}

export function createSandboxSessionIdempotencyKey(handsRunId: HandsRunId, policyName: string): string {
  return createKey('idem', [handsRunId, policyName]);
}

export function createDeterministicSandboxSessionId(
  agentId: AgentId,
  handsRunId: HandsRunId,
  policyName: string,
): SandboxSessionId {
  return createDeterministicIdentifier(
    'sbx',
    `sandbox-session:${agentId}:${handsRunId}:${policyName}`,
  ) as SandboxSessionId;
}

export function createTaskStartRequestIdempotencyKey(
  taskId: string,
  taskEnvelopeId: string,
  attemptNumber: number,
): string {
  return createKey('idem', [taskId, taskEnvelopeId, `attempt-${attemptNumber}`]);
}

export function createScheduleOccurrenceKey(scheduleId: ScheduleId, occurrenceAt: string): string {
  return createKey('occ', [scheduleId, occurrenceAt]);
}

export function createDueTaskHeadStartKey(taskId: string, dueAt: string): string {
  return createKey('due', [taskId, dueAt]);
}

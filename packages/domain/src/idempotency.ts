import { type AgentId, type HandsRunId, type ScheduleId } from '@echidna-claw/contracts';

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

export function createInboundMessageIdempotencyKey(agentId: AgentId, externalUpdateId: string): string {
  return createKey('idem', [agentId, externalUpdateId]);
}

export function createTaskCreationIdempotencyKey(
  agentId: AgentId,
  requestedOutcome: string,
  dueAt?: string | null,
): string {
  return createKey('idem', [agentId, requestedOutcome, dueAt ?? 'immediate']);
}

export function createApprovalIdempotencyKey(taskId: string, approvalSummary: string): string {
  return createKey('idem', [taskId, approvalSummary]);
}

export function createSandboxSessionIdempotencyKey(handsRunId: HandsRunId, policyName: string): string {
  return createKey('idem', [handsRunId, policyName]);
}

export function createScheduleOccurrenceKey(scheduleId: ScheduleId, occurrenceAt: string): string {
  return createKey('occ', [scheduleId, occurrenceAt]);
}

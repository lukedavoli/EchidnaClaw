import { createHash } from 'node:crypto';

import type {
  AuditEvent,
  AuditEventCategory,
  AuditEventOutcome,
  CorrelationMetadata,
  RepositoryConfig,
} from '@echidna-claw/contracts';
import { DuplicateRecordError, type StoredRecord } from '@echidna-claw/persistence';
import { redactAuditAttributes, type Logger } from '@echidna-claw/observability';

import type { RepositoryBundle } from '../../adapters/repositories/index.js';

function createDeterministicAuditEventId(input: {
  action: string;
  agentId: string;
  category: AuditEventCategory;
  correlation: CorrelationMetadata;
  occurredAt: string;
  outcome: AuditEventOutcome;
}): AuditEvent['id'] {
  const basis = [
    input.agentId,
    input.category,
    input.action,
    input.outcome,
    input.occurredAt,
    input.correlation.traceId,
    input.correlation.headTurnId ?? '',
    input.correlation.handsRunId ?? '',
    input.correlation.sandboxSessionId ?? '',
    input.correlation.approvalId ?? '',
    input.correlation.taskId ?? '',
  ].join('|');

  return `aud_${createHash('sha1').update(basis).digest('hex').slice(0, 24)}`;
}

function addRetentionDays(timestamp: string, days: number): string {
  return new Date(Date.parse(timestamp) + days * 24 * 60 * 60_000).toISOString();
}

export interface AuditHistoryService {
  append(input: {
    action: string;
    agentId: string;
    artifactIds?: string[];
    attributes?: Record<string, unknown>;
    category: AuditEventCategory;
    correlation: CorrelationMetadata;
    occurredAt?: string;
    outcome: AuditEventOutcome;
    summary: string;
  }): Promise<StoredRecord<AuditEvent>>;
}

export function createAuditHistoryService(options: {
  logger: Logger;
  repositories: RepositoryBundle;
  repositoryConfig: RepositoryConfig;
}): AuditHistoryService {
  return {
    async append(input) {
      const occurredAt = input.occurredAt ?? new Date().toISOString();
      const auditEvent: AuditEvent = {
        id: createDeterministicAuditEventId({
          action: input.action,
          agentId: input.agentId,
          category: input.category,
          correlation: input.correlation,
          occurredAt,
          outcome: input.outcome,
        }),
        recordType: 'audit_event',
        schemaVersion: 1,
        createdAt: occurredAt,
        updatedAt: occurredAt,
        correlation: input.correlation,
        agentId: input.agentId,
        occurredAt,
        retentionUntil: addRetentionDays(
          occurredAt,
          options.repositoryConfig.observability.auditRetentionDays,
        ),
        category: input.category,
        action: input.action,
        outcome: input.outcome,
        summary: input.summary,
        attributes: redactAuditAttributes(input.attributes ?? {}),
        artifactIds: input.artifactIds ?? [],
      };

      try {
        return await options.repositories.auditEvents.append(auditEvent);
      } catch (error) {
        if (error instanceof DuplicateRecordError) {
          const existing = await options.repositories.auditEvents.get(input.agentId, auditEvent.id);
          if (existing) {
            return existing;
          }
        }

        options.logger.warn('audit_history.append_failed', {
          action: input.action,
          agentId: input.agentId,
          category: input.category,
          message: error instanceof Error ? error.message : 'Unknown audit append failure.',
          outcome: input.outcome,
        });
        throw error;
      }
    },
  };
}

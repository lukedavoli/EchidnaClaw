import { createHash } from 'node:crypto';

import type {
  CorrelationMetadata,
  RepositoryConfig,
  UsageEvent,
  UsageProvider,
  UsageSource,
} from '@echidna-claw/contracts';
import { DuplicateRecordError, type StoredRecord } from '@echidna-claw/persistence';
import { estimateUsageCost, type Logger } from '@echidna-claw/observability';

import type { RepositoryBundle } from '../../adapters/repositories/index.js';

function createDeterministicUsageEventId(input: {
  agentId: string;
  analyticsGroup: string | null;
  correlation: CorrelationMetadata;
  model: UsageEvent['model'];
  occurredAt: string;
  operation: string;
  providerOperationId: string | null;
  source: UsageSource;
}): UsageEvent['id'] {
  const basis = [
    input.agentId,
    input.source,
    input.model,
    input.operation,
    input.occurredAt,
    input.analyticsGroup ?? '',
    input.providerOperationId ?? '',
    input.correlation.analyticsKey ?? '',
    input.correlation.traceId,
    input.correlation.headTurnId ?? '',
    input.correlation.handsRunId ?? '',
    input.correlation.sandboxSessionId ?? '',
    input.correlation.taskId ?? '',
  ].join('|');

  return `use_${createHash('sha1').update(basis).digest('hex').slice(0, 24)}`;
}

export interface UsageAccountingService {
  appendUsage(input: {
    agentId: string;
    analyticsGroup?: string | null;
    correlation: CorrelationMetadata;
    model: UsageEvent['model'];
    occurredAt?: string;
    operation: string;
    provider?: UsageProvider;
    providerOperationId?: string | null;
    source: UsageSource;
    tokens: UsageEvent['tokens'];
  }): Promise<StoredRecord<UsageEvent>>;
}

export function createUsageAccountingService(options: {
  logger: Logger;
  repositories: RepositoryBundle;
  repositoryConfig: RepositoryConfig;
}): UsageAccountingService {
  return {
    async appendUsage(input) {
      const occurredAt = input.occurredAt ?? new Date().toISOString();
      const costing = estimateUsageCost({
        model: input.model,
        occurredAt,
        pricingEntries: options.repositoryConfig.models.pricing,
        tokens: input.tokens,
      });
      const usageEvent: UsageEvent = {
        id: createDeterministicUsageEventId({
          agentId: input.agentId,
          analyticsGroup: input.analyticsGroup ?? null,
          correlation: input.correlation,
          model: input.model,
          occurredAt,
          operation: input.operation,
          providerOperationId: input.providerOperationId ?? null,
          source: input.source,
        }),
        recordType: 'usage_event',
        schemaVersion: 1,
        createdAt: occurredAt,
        updatedAt: occurredAt,
        correlation: input.correlation,
        agentId: input.agentId,
        source: input.source,
        provider: input.provider ?? 'azure-foundry',
        model: input.model,
        operation: input.operation,
        occurredAt,
        providerOperationId: input.providerOperationId ?? null,
        analyticsGroup: input.analyticsGroup ?? null,
        tokens: input.tokens,
        estimatedCostUsd: costing.estimatedCostUsd,
        pricingStatus: costing.pricingStatus,
      };

      try {
        return await options.repositories.usageEvents.append(usageEvent);
      } catch (error) {
        if (error instanceof DuplicateRecordError) {
          const existing = await options.repositories.usageEvents.get(input.agentId, usageEvent.id);
          if (existing) {
            return existing;
          }
        }

        options.logger.warn('usage_accounting.append_failed', {
          agentId: input.agentId,
          message: error instanceof Error ? error.message : 'Unknown usage append failure.',
          operation: input.operation,
          source: input.source,
        });
        throw error;
      }
    },
  };
}

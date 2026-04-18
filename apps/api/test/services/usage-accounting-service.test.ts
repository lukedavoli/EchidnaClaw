import {
  createApiTestRepositoryBundle,
  createRuntimeTestHarness,
  seedActiveTelegramAgentState,
} from '@echidna-claw/testing';
import { createCorrelationMetadata } from '@echidna-claw/persistence';
import { describe, expect, it } from 'vitest';

import { createUsageAccountingService } from '../../src/services/runtime/usage-accounting-service.js';

describe('usage accounting service', () => {
  it('deduplicates provider usage events and stores estimated cost metadata', async () => {
    const harness = createRuntimeTestHarness({
      serviceName: 'usage-accounting-test',
    });
    const seeded = await seedActiveTelegramAgentState({
      agent: {
        id: 'agt_usage',
        primaryChannelId: 'chn_usage',
      },
      channel: {
        id: 'chn_usage',
      },
      suite: harness.suite,
    });
    const repositories = createApiTestRepositoryBundle(harness.suite);
    const service = createUsageAccountingService({
      logger: harness.loggerFactory.createLogger({ service: 'usage_accounting_test' }),
      repositories,
      repositoryConfig: harness.repositoryConfig,
    });
    const correlation = createCorrelationMetadata({
      analyticsKey: 'anl_usage',
      idempotencyKey: 'idem_usage',
      traceId: 'trc_usage',
    });

    const first = await service.appendUsage({
      agentId: seeded.agent.value.id,
      analyticsGroup: 'head-turn',
      correlation,
      model: 'gpt-5.4-mini',
      occurredAt: '2026-04-12T00:00:00.000Z',
      operation: 'head.execute',
      providerOperationId: 'prov-usage-1',
      source: 'head',
      tokens: {
        inputTokens: 1000,
        outputTokens: 500,
        reasoningTokens: null,
        toolInputTokens: null,
        toolOutputTokens: null,
      },
    });
    const replayed = await service.appendUsage({
      agentId: seeded.agent.value.id,
      analyticsGroup: 'head-turn',
      correlation,
      model: 'gpt-5.4-mini',
      occurredAt: '2026-04-12T00:00:00.000Z',
      operation: 'head.execute',
      providerOperationId: 'prov-usage-1',
      source: 'head',
      tokens: {
        inputTokens: 1000,
        outputTokens: 500,
        reasoningTokens: null,
        toolInputTokens: null,
        toolOutputTokens: null,
      },
    });

    expect(first.value.pricingStatus).toBe('estimated');
    expect(first.value.estimatedCostUsd).toBeGreaterThan(0);
    expect(replayed.value.id).toBe(first.value.id);
    expect(replayed.etag).toBe(first.etag);
  });
});

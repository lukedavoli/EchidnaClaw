import {
  createApiTestRepositoryBundle,
  createRuntimeTestHarness,
  seedActiveTelegramAgentState,
} from '@echidna-claw/testing';
import { createCorrelationMetadata } from '@echidna-claw/persistence';
import { describe, expect, it } from 'vitest';

import { createAuditHistoryService } from '../../src/services/runtime/audit-history-service.js';

describe('audit history service', () => {
  it('applies retention and redacts sensitive attributes deterministically', async () => {
    const harness = createRuntimeTestHarness({
      serviceName: 'audit-history-test',
    });
    const seeded = await seedActiveTelegramAgentState({
      agent: {
        id: 'agt_audit',
        primaryChannelId: 'chn_audit',
      },
      channel: {
        id: 'chn_audit',
      },
      suite: harness.suite,
    });
    const repositories = createApiTestRepositoryBundle(harness.suite);
    const service = createAuditHistoryService({
      logger: harness.loggerFactory.createLogger({ service: 'audit_history_test' }),
      repositories,
      repositoryConfig: harness.repositoryConfig,
    });
    const correlation = createCorrelationMetadata({
      idempotencyKey: 'idem_audit',
      traceId: 'trc_audit',
    });

    const first = await service.append({
      action: 'sandbox.command',
      agentId: seeded.agent.value.id,
      attributes: {
        authorization: 'Bearer super-secret-token',
        nested: {
          token: 'child-secret',
        },
        note: 'safe to keep',
      },
      category: 'sandbox_command',
      correlation,
      occurredAt: '2026-04-12T00:00:00.000Z',
      outcome: 'succeeded',
      summary: 'Executed an allowlisted sandbox command.',
    });
    const replayed = await service.append({
      action: 'sandbox.command',
      agentId: seeded.agent.value.id,
      attributes: {
        authorization: 'Bearer super-secret-token',
        nested: {
          token: 'child-secret',
        },
        note: 'safe to keep',
      },
      category: 'sandbox_command',
      correlation,
      occurredAt: '2026-04-12T00:00:00.000Z',
      outcome: 'succeeded',
      summary: 'Executed an allowlisted sandbox command.',
    });

    expect(first.value.retentionUntil).toBe('2026-05-12T00:00:00.000Z');
    expect(first.value.attributes).toEqual({
      authorization: '[REDACTED]',
      nested: '{"token":"[REDACTED]"}',
      note: 'safe to keep',
    });
    expect(replayed.value.id).toBe(first.value.id);
    expect(replayed.etag).toBe(first.etag);
  });
});

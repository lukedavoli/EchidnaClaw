import {
  agentSchema,
  analyticsOverviewSchema,
  correlationMetadataSchema,
  usageEventSchema,
  type Agent,
  type AnalyticsOverview,
  type UsageEvent,
} from '@echidna-claw/contracts';

const baseTimestamp = '2026-04-13T00:00:00.000Z';

export function createFixtureCorrelation(suffix: string) {
  return correlationMetadataSchema.parse({
    idempotencyKey: `idem_fixture-${suffix}`,
    requestedBy: {
      displayName: 'Fixture Operator',
      id: 'opr_fixture-operator',
      kind: 'operator',
    },
    traceId: `trc_fixture-${suffix}`,
  });
}

export function createAgentFixture(overrides: Partial<Agent> = {}): Agent {
  return agentSchema.parse({
    correlation: createFixtureCorrelation('agent'),
    createdAt: baseTimestamp,
    factoryProfileVersion: 'factory-v1',
    headModel: 'gpt-5.4-mini',
    id: 'agt_fixture-agent',
    lifecycleState: 'active',
    name: 'Ops Triage Agent',
    provisioningState: 'active',
    recordType: 'agent',
    responsibilitiesSummary: 'Handles operator follow-up and monitoring.',
    restoredAt: null,
    schemaVersion: 1,
    softDeletedAt: null,
    timeZone: 'Australia/Sydney',
    updatedAt: baseTimestamp,
    ...overrides,
  });
}

export function createUsageEventFixture(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return usageEventSchema.parse({
    agentId: 'agt_fixture-agent',
    correlation: createFixtureCorrelation('usage'),
    createdAt: baseTimestamp,
    estimatedCostUsd: 0.31,
    id: 'use_fixture-usage',
    model: 'gpt-5.4-mini',
    occurredAt: baseTimestamp,
    operation: 'head_turn',
    recordType: 'usage_event',
    schemaVersion: 1,
    source: 'web_control_plane',
    tokens: {
      inputTokens: 2400,
      outputTokens: 900,
    },
    updatedAt: baseTimestamp,
    ...overrides,
  });
}

export function createAnalyticsOverviewFixture(
  events: UsageEvent[] = [
    createUsageEventFixture(),
    createUsageEventFixture({
      estimatedCostUsd: 0.12,
      id: 'use_fixture-usage-2',
      source: 'head',
      tokens: {
        inputTokens: 1200,
        outputTokens: 640,
      },
    }),
  ],
): AnalyticsOverview {
  return analyticsOverviewSchema.parse({
    events,
    totalEstimatedCostUsd: events.reduce((sum, event) => sum + event.estimatedCostUsd, 0),
    totalInputTokens: events.reduce((sum, event) => sum + event.tokens.inputTokens, 0),
    totalOutputTokens: events.reduce((sum, event) => sum + event.tokens.outputTokens, 0),
  });
}

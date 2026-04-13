import {
  adminAgentDetailSchema,
  adminAgentSummarySchema,
  agentSchema,
  analyticsOverviewSchema,
  channelSchema,
  correlationMetadataSchema,
  usageEventSchema,
  type AdminAgentDetail,
  type AdminAgentSummary,
  type Agent,
  type AnalyticsOverview,
  type Channel,
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
    primaryChannelId: 'chn_fixture-agent',
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

export function createChannelFixture(overrides: Partial<Channel> = {}): Channel {
  return channelSchema.parse({
    agentId: 'agt_fixture-agent',
    botDisplayName: 'Ops Triage Bot',
    botUserId: 'telegram-bot-user',
    boundAt: baseTimestamp,
    correlation: createFixtureCorrelation('channel'),
    createdAt: baseTimestamp,
    credentialId: undefined,
    externalChatId: 'chat-123',
    externalHandle: 'ops-triage-bot',
    id: 'chn_fixture-agent',
    lastExternalMessageId: undefined,
    lastInboundSequence: 0,
    lastProvisioningErrorCode: undefined,
    lastProvisioningErrorMessage: undefined,
    lastProvisioningFailedAt: null,
    lastRecoveryRequestedAt: null,
    provisioningRequestedAt: baseTimestamp,
    provisioningStartedAt: baseTimestamp,
    provider: 'telegram',
    recordType: 'channel',
    recoveryAttemptCount: 0,
    schemaVersion: 1,
    state: 'active',
    updatedAt: baseTimestamp,
    ...overrides,
  });
}

export function createAdminAgentSummaryFixture(input: {
  agent?: Partial<Agent>;
  primaryChannel?: Partial<Channel> | null;
} = {}): AdminAgentSummary {
  const agent = createAgentFixture(input.agent);
  const primaryChannelOverrides =
    input.primaryChannel === null || input.primaryChannel === undefined
      ? input.primaryChannel
      : (() => {
          const { conversationUrl: _conversationUrl, ...channelOverrides } = input.primaryChannel as Partial<
            Channel & {
              conversationUrl?: string;
            }
          >;

          return channelOverrides;
        })();
  const primaryChannel =
    primaryChannelOverrides === null
      ? null
      : createChannelFixture({
          agentId: agent.id,
          id: agent.primaryChannelId,
          ...primaryChannelOverrides,
        });

  return adminAgentSummarySchema.parse({
    agent,
    primaryChannel: primaryChannel
      ? {
          id: primaryChannel.id,
          provider: primaryChannel.provider,
          state: primaryChannel.state,
          externalHandle: primaryChannel.externalHandle,
          externalChatId: primaryChannel.externalChatId,
          botUserId: primaryChannel.botUserId,
          botDisplayName: primaryChannel.botDisplayName,
          credentialId: primaryChannel.credentialId,
          provisioningRequestedAt: primaryChannel.provisioningRequestedAt,
          provisioningStartedAt: primaryChannel.provisioningStartedAt,
          boundAt: primaryChannel.boundAt,
          lastProvisioningFailedAt: primaryChannel.lastProvisioningFailedAt,
          lastProvisioningErrorCode: primaryChannel.lastProvisioningErrorCode,
          lastProvisioningErrorMessage: primaryChannel.lastProvisioningErrorMessage,
          recoveryAttemptCount: primaryChannel.recoveryAttemptCount,
          lastRecoveryRequestedAt: primaryChannel.lastRecoveryRequestedAt,
          conversationUrl: primaryChannel.externalHandle
            ? `https://t.me/${primaryChannel.externalHandle.replace(/^@+/, '')}`
            : undefined,
        }
      : null,
  });
}

export function createAdminAgentDetailFixture(input?: {
  agent?: Partial<Agent>;
  primaryChannel?: Partial<Channel> | null;
}): AdminAgentDetail {
  return adminAgentDetailSchema.parse(createAdminAgentSummaryFixture(input));
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

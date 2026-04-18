import type { Agent, Channel, WorkingContext } from '@echidna-claw/contracts';
import { loadRepositoryConfig } from '@echidna-claw/config';
import {
  createLoggerFactory,
  type LogSink,
  type LoggerFactory,
} from '@echidna-claw/observability';
import {
  AesGcmCredentialEnvelopeCipher,
  FakeClock,
  InMemoryArtifactContentStore,
  InMemoryRecordStore,
  StaticKeyEncryptionKey,
  createAgent,
  createChannel,
  createCorrelationMetadata,
  createRepositorySuite,
  createWorkingContext,
  type RepositorySuite,
} from '@echidna-claw/persistence';

export function createRuntimeTestHarness(options: {
  logSink?: LogSink;
  now?: string;
  serviceName?: string;
} = {}): {
  artifactContentStore: InMemoryArtifactContentStore;
  clock: FakeClock;
  loggerFactory: LoggerFactory;
  repositoryConfig: ReturnType<typeof loadRepositoryConfig>;
  suite: RepositorySuite;
} {
  const clock = new FakeClock(new Date(options.now ?? '2026-04-12T00:00:00.000Z'));
  const artifactContentStore = new InMemoryArtifactContentStore();
  const loggerFactory = createLoggerFactory({
    level: 'debug',
    serviceName: options.serviceName ?? 'test-harness',
    ...(options.logSink ? { sink: options.logSink } : {}),
  });
  const suite = createRepositorySuite({
    artifactContentStore,
    clock,
    credentialEnvelopeCipher: new AesGcmCredentialEnvelopeCipher(
      new StaticKeyEncryptionKey('local://testing-key', new Uint8Array([5, 11, 17, 23, 31])),
    ),
    recordStore: new InMemoryRecordStore(),
  });

  return {
    artifactContentStore,
    clock,
    loggerFactory,
    repositoryConfig: loadRepositoryConfig(),
    suite,
  };
}

export function createApiTestRepositoryBundle(suite: RepositorySuite) {
  return {
    agents: suite.agents,
    agentRegistry: suite.agentRegistry,
    analytics: {
      async getOverview() {
        return {
          totalEstimatedCostUsd: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          events: [],
        };
      },
    },
    approvals: {
      async getState() {
        return 'requested' as const;
      },
    },
    auditEvents: suite.auditEvents,
    channels: suite.channels,
    credentialCaptures: suite.credentialCaptures,
    credentials: suite.credentials,
    execution: suite.execution,
    idempotency: suite.idempotency,
    messages: suite.messages,
    runJournals: suite.runJournals,
    schedules: suite.schedules,
    tasks: suite.tasks,
    telegramProvisioningSessions: suite.telegramProvisioningSessions,
    usageEvents: suite.usageEvents,
    workingContexts: suite.workingContexts,
  };
}

export async function seedActiveTelegramAgentState(input: {
  agent?: Partial<Agent>;
  channel?: Partial<Channel>;
  workingContext?: Partial<WorkingContext>;
  suite: Pick<RepositorySuite, 'agents' | 'channels' | 'workingContexts'>;
}): Promise<{
  agent: Awaited<ReturnType<RepositorySuite['agents']['create']>>;
  channel: Awaited<ReturnType<RepositorySuite['channels']['create']>>;
  workingContext: Awaited<ReturnType<RepositorySuite['workingContexts']['create']>>;
}> {
  const correlation = createCorrelationMetadata({
    idempotencyKey: 'idem_testing-seed',
    traceId: 'trc_testing-seed',
  });
  const agent = await input.suite.agents.create(
    createAgent({
      correlation,
      lifecycleState: 'active',
      provisioningState: 'active',
      ...(input.agent ?? {}),
    }),
  );
  const channel = await input.suite.channels.create(
    createChannel({
      agentId: agent.value.id,
      correlation,
      id: agent.value.primaryChannelId,
      state: 'active',
      ...(input.channel ?? {}),
    }),
  );
  const workingContext = await input.suite.workingContexts.create(
    createWorkingContext({
      agentId: agent.value.id,
      correlation,
      ...(input.workingContext ?? {}),
    }),
  );

  return {
    agent,
    channel,
    workingContext,
  };
}

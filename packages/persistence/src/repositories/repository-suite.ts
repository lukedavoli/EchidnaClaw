import { type TokenCredential } from '@azure/identity';

import {
  AzureArtifactContentStore,
  InMemoryArtifactContentStore,
  type ArtifactContentStore,
} from '../blob/artifact-store.js';
import { createBlobServiceClient } from '../clients/blob.js';
import { createCosmosClient } from '../clients/cosmos.js';
import { createKeyVaultKeyEncryptionKey } from '../clients/key-vault.js';
import {
  AesGcmCredentialEnvelopeCipher,
  StaticKeyEncryptionKey,
  type CredentialEnvelopeCipher,
} from '../crypto/credential-envelope.js';
import { type Clock, SystemClock } from '../testing/fake-clock.js';
import { DefaultAgentRepository, type AgentRepository } from './agent-repository.js';
import {
  DefaultAgentRegistryRepository,
  type AgentRegistryRepository,
} from './agent-registry-repository.js';
import { DefaultApprovalRepository, type ApprovalRepository } from './approval-repository.js';
import { DefaultArtifactRepository, type ArtifactRepository } from './artifact-repository.js';
import { DefaultChannelRepository, type ChannelRepository } from './channel-repository.js';
import { CosmosRecordStore } from './cosmos-record-store.js';
import {
  DefaultCredentialCaptureRepository,
  type CredentialCaptureRepository,
} from './credential-capture-repository.js';
import { DefaultCredentialRepository, type CredentialRepository } from './credential-repository.js';
import { DefaultExecutionRepository, type ExecutionRepository } from './execution-repository.js';
import { DefaultIdempotencyRepository, type IdempotencyRepository } from './idempotency-repository.js';
import { InMemoryRecordStore } from './in-memory-record-store.js';
import { DefaultMessageRepository, type MessageRepository } from './message-repository.js';
import { type PersistedRecordStore } from './store.js';
import { DefaultRunJournalRepository, type RunJournalRepository } from './run-journal-repository.js';
import { DefaultScheduleRepository, type ScheduleRepository } from './schedule-repository.js';
import { DefaultTaskRepository, type TaskRepository } from './task-repository.js';
import { DefaultUsageEventRepository, type UsageEventRepository } from './usage-event-repository.js';
import { DefaultWorkingContextRepository, type WorkingContextRepository } from './working-context-repository.js';

export interface RepositorySuite {
  agents: AgentRepository;
  agentRegistry: AgentRegistryRepository;
  approvals: ApprovalRepository;
  artifacts: ArtifactRepository;
  channels: ChannelRepository;
  credentialCaptures: CredentialCaptureRepository;
  credentials: CredentialRepository;
  execution: ExecutionRepository;
  idempotency: IdempotencyRepository;
  messages: MessageRepository;
  runJournals: RunJournalRepository;
  schedules: ScheduleRepository;
  tasks: TaskRepository;
  usageEvents: UsageEventRepository;
  workingContexts: WorkingContextRepository;
}

export interface RepositorySuiteDependencies {
  artifactContentStore: ArtifactContentStore;
  clock?: Clock;
  credentialEnvelopeCipher: CredentialEnvelopeCipher;
  recordStore: PersistedRecordStore;
}

export interface AzureRepositorySuiteOptions {
  artifactsContainerName: string;
  blobAccountUrl: string;
  cosmosDatabaseName: string;
  cosmosEndpoint: string;
  credential?: TokenCredential;
  clock?: Clock;
  keyEncryptionKeyId: string;
  agentStateContainerName?: string;
  usageEventsContainerName?: string;
}

export function createRepositorySuite(dependencies: RepositorySuiteDependencies): RepositorySuite {
  const clock = dependencies.clock ?? new SystemClock();
  const agents = new DefaultAgentRepository(dependencies.recordStore);
  const channels = new DefaultChannelRepository(dependencies.recordStore);

  return {
    agents,
    agentRegistry: new DefaultAgentRegistryRepository(dependencies.recordStore, agents, channels),
    approvals: new DefaultApprovalRepository(dependencies.recordStore),
    artifacts: new DefaultArtifactRepository(
      dependencies.recordStore,
      dependencies.artifactContentStore,
      clock,
    ),
    channels,
    credentialCaptures: new DefaultCredentialCaptureRepository(dependencies.recordStore),
    credentials: new DefaultCredentialRepository(
      dependencies.recordStore,
      dependencies.credentialEnvelopeCipher,
    ),
    execution: new DefaultExecutionRepository(dependencies.recordStore),
    idempotency: new DefaultIdempotencyRepository(dependencies.recordStore),
    messages: new DefaultMessageRepository(dependencies.recordStore),
    runJournals: new DefaultRunJournalRepository(dependencies.recordStore),
    schedules: new DefaultScheduleRepository(dependencies.recordStore),
    tasks: new DefaultTaskRepository(dependencies.recordStore),
    usageEvents: new DefaultUsageEventRepository(dependencies.recordStore),
    workingContexts: new DefaultWorkingContextRepository(dependencies.recordStore),
  };
}

export function createAzureRepositorySuite(options: AzureRepositorySuiteOptions): RepositorySuite {
  const credential = options.credential;
  const recordStore = new CosmosRecordStore({
    client: createCosmosClient({
      endpoint: options.cosmosEndpoint,
      ...(credential ? { credential } : {}),
    }),
    databaseName: options.cosmosDatabaseName,
    ...(options.agentStateContainerName
      ? { agentStateContainerName: options.agentStateContainerName }
      : {}),
    ...(options.usageEventsContainerName
      ? { usageEventsContainerName: options.usageEventsContainerName }
      : {}),
  });
  const artifactContentStore = new AzureArtifactContentStore(
    createBlobServiceClient({
      accountUrl: options.blobAccountUrl,
      ...(credential ? { credential } : {}),
    }),
    options.artifactsContainerName,
  );
  const credentialEnvelopeCipher = new AesGcmCredentialEnvelopeCipher(
    createKeyVaultKeyEncryptionKey({
      keyId: options.keyEncryptionKeyId,
      ...(credential ? { credential } : {}),
    }),
  );

  return createRepositorySuite({
    recordStore,
    artifactContentStore,
    credentialEnvelopeCipher,
    ...(options.clock ? { clock: options.clock } : {}),
  });
}

export function createInMemoryRepositorySuite(options?: {
  clock?: Clock;
  wrappingKey?: Uint8Array;
}): RepositorySuite {
  const wrappingKey = options?.wrappingKey ?? new Uint8Array([11, 29, 47, 53, 71, 89, 97, 113]);

  return createRepositorySuite({
    recordStore: new InMemoryRecordStore(),
    artifactContentStore: new InMemoryArtifactContentStore(),
    credentialEnvelopeCipher: new AesGcmCredentialEnvelopeCipher(
      new StaticKeyEncryptionKey('local://credential-encryption-key', wrappingKey),
    ),
    ...(options?.clock ? { clock: options.clock } : {}),
  });
}

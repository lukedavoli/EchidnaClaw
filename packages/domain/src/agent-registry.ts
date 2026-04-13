import { createHash } from 'node:crypto';

import type {
  Agent,
  AgentId,
  Channel,
  ChannelId,
  CorrelationMetadata,
  RepositoryConfig,
} from '@echidna-claw/contracts';

import { transitionAgentProvisioningState, transitionChannelState } from './state-machines.js';

const IDENTIFIER_HASH_LENGTH = 24;
const SCHEMA_VERSION = 1 as const;

export type AgentRegistryRecords = {
  agent: Agent;
  primaryChannel: Channel;
};

export type CompleteProvisioningInput = {
  agent: Agent;
  boundAt: string;
  primaryChannel: Channel;
  botUserId: string;
  botDisplayName?: string;
  credentialId?: string;
  externalChatId?: string;
  externalHandle?: string;
};

export type ProvisioningFailureInput = {
  agent: Agent;
  primaryChannel: Channel;
  failedAt: string;
  errorCode?: string;
  errorMessage?: string;
};

function createDeterministicIdentifier(prefix: 'agt' | 'chn', source: string): string {
  const digest = createHash('sha256').update(source).digest('hex').slice(0, IDENTIFIER_HASH_LENGTH);
  return `${prefix}_${digest}`;
}

function touchAgent(agent: Agent, updatedAt: string): Agent {
  return {
    ...agent,
    updatedAt,
  };
}

function touchChannel(channel: Channel, updatedAt: string): Channel {
  return {
    ...channel,
    updatedAt,
  };
}

function ensureAgentProvisioning(agent: Agent, updatedAt: string): Agent {
  if (agent.provisioningState === 'provisioning' || agent.provisioningState === 'active') {
    return touchAgent(agent, updatedAt);
  }

  return transitionAgentProvisioningState(agent, 'provisioning', updatedAt);
}

function ensureChannelProvisioning(channel: Channel, updatedAt: string): Channel {
  if (channel.state === 'provisioning' || channel.state === 'active') {
    return touchChannel(channel, updatedAt);
  }

  return transitionChannelState(channel, 'provisioning', updatedAt);
}

function activateAgent(agent: Agent, activatedAt: string): Agent {
  if (agent.provisioningState === 'active') {
    return touchAgent(agent, activatedAt);
  }

  return transitionAgentProvisioningState(agent, 'active', activatedAt);
}

function activateChannel(channel: Channel, activatedAt: string): Channel {
  if (channel.state === 'active') {
    return touchChannel(channel, activatedAt);
  }

  return transitionChannelState(channel, 'active', activatedAt);
}

function failAgent(agent: Agent, failedAt: string): Agent {
  if (agent.provisioningState === 'provisioning_failed') {
    return touchAgent(agent, failedAt);
  }

  return transitionAgentProvisioningState(agent, 'provisioning_failed', failedAt);
}

function failChannel(channel: Channel, failedAt: string): Channel {
  if (channel.state === 'provisioning_failed') {
    return touchChannel(channel, failedAt);
  }

  return transitionChannelState(channel, 'provisioning_failed', failedAt);
}

export function createDeterministicAgentId(idempotencyKey: string): AgentId {
  return createDeterministicIdentifier('agt', `agent:${idempotencyKey}`) as AgentId;
}

export function createDeterministicPrimaryChannelId(agentId: AgentId): ChannelId {
  return createDeterministicIdentifier('chn', `primary-channel:${agentId}:telegram`) as ChannelId;
}

export function createFactoryDefaultAgentRecord(input: {
  correlation: CorrelationMetadata;
  createdAt: string;
  name: string;
  repositoryConfig: RepositoryConfig;
  timeZone?: string;
}): Agent {
  const agentId = createDeterministicAgentId(input.correlation.idempotencyKey);
  const primaryChannelId = createDeterministicPrimaryChannelId(agentId);

  return {
    id: agentId,
    recordType: 'agent',
    schemaVersion: SCHEMA_VERSION,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    correlation: input.correlation,
    name: input.name,
    timeZone: input.timeZone ?? input.repositoryConfig.agents.factoryProfile.defaultTimeZone,
    headModel: input.repositoryConfig.models.defaultModel,
    primaryChannelId,
    provisioningState: 'pending_provisioning',
    lifecycleState: 'active',
    softDeletedAt: null,
    restoredAt: null,
    factoryProfileVersion: input.repositoryConfig.agents.factoryProfile.version,
    responsibilitiesSummary:
      input.repositoryConfig.agents.factoryProfile.initialResponsibilitiesSummary,
  };
}

export function createPlaceholderPrimaryChannelRecord(input: {
  agent: Agent;
  correlation: CorrelationMetadata;
  createdAt: string;
}): Channel {
  return {
    id: input.agent.primaryChannelId,
    recordType: 'channel',
    schemaVersion: SCHEMA_VERSION,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    correlation: input.correlation,
    agentId: input.agent.id,
    provider: 'telegram',
    state: 'pending_provisioning',
    externalHandle: undefined,
    externalChatId: undefined,
    botUserId: undefined,
    botDisplayName: undefined,
    credentialId: undefined,
    trustedExternalUserId: undefined,
    trustedExternalUserHandle: undefined,
    trustedExternalDisplayName: undefined,
    provisioningRequestedAt: input.createdAt,
    provisioningStartedAt: null,
    boundAt: null,
    lastProvisioningFailedAt: null,
    lastProvisioningErrorCode: undefined,
    lastProvisioningErrorMessage: undefined,
    recoveryAttemptCount: 0,
    lastRecoveryRequestedAt: null,
    lastInboundSequence: 0,
    lastInboundReceivedAt: null,
    lastOutboundSentAt: null,
    lastInboundExternalMessageId: undefined,
    lastOutboundExternalMessageId: undefined,
    lastExternalMessageId: undefined,
  };
}

export function createAgentRegistryRecords(input: {
  correlation: CorrelationMetadata;
  createdAt: string;
  name: string;
  repositoryConfig: RepositoryConfig;
  timeZone?: string;
}): AgentRegistryRecords {
  const agent = createFactoryDefaultAgentRecord(input);

  return {
    agent,
    primaryChannel: createPlaceholderPrimaryChannelRecord({
      agent,
      correlation: input.correlation,
      createdAt: input.createdAt,
    }),
  };
}

export function markAgentProvisioningStarted(input: {
  agent: Agent;
  primaryChannel: Channel;
  startedAt: string;
}): AgentRegistryRecords {
  const agent = ensureAgentProvisioning(input.agent, input.startedAt);
  const primaryChannel = {
    ...ensureChannelProvisioning(input.primaryChannel, input.startedAt),
    provisioningStartedAt: input.primaryChannel.provisioningStartedAt ?? input.startedAt,
    updatedAt: input.startedAt,
  };

  return {
    agent,
    primaryChannel,
  };
}

export function completeAgentProvisioning(input: CompleteProvisioningInput): AgentRegistryRecords {
  const provisioning = markAgentProvisioningStarted({
    agent: input.agent,
    primaryChannel: input.primaryChannel,
    startedAt: input.boundAt,
  });
  const agent = activateAgent(provisioning.agent, input.boundAt);
  const primaryChannel = {
    ...activateChannel(provisioning.primaryChannel, input.boundAt),
    botUserId: input.botUserId,
    botDisplayName: input.botDisplayName,
    boundAt: input.boundAt,
    credentialId: input.credentialId,
    externalChatId: input.externalChatId,
    externalHandle: input.externalHandle,
    lastProvisioningFailedAt: null,
    lastProvisioningErrorCode: undefined,
    lastProvisioningErrorMessage: undefined,
    updatedAt: input.boundAt,
  };

  return {
    agent,
    primaryChannel,
  };
}

export function recordAgentProvisioningFailure(input: ProvisioningFailureInput): AgentRegistryRecords {
  const agent = failAgent(input.agent, input.failedAt);
  const primaryChannel = {
    ...failChannel(input.primaryChannel, input.failedAt),
    lastProvisioningFailedAt: input.failedAt,
    lastProvisioningErrorCode: input.errorCode,
    lastProvisioningErrorMessage: input.errorMessage,
    updatedAt: input.failedAt,
  };

  return {
    agent,
    primaryChannel,
  };
}

export function resetAgentProvisioningForRetry(input: {
  agent: Agent;
  primaryChannel: Channel;
  requestedAt: string;
}): AgentRegistryRecords {
  const agent =
    input.agent.provisioningState === 'pending_provisioning'
      ? touchAgent(input.agent, input.requestedAt)
      : transitionAgentProvisioningState(input.agent, 'pending_provisioning', input.requestedAt);
  const primaryChannel =
    input.primaryChannel.state === 'pending_provisioning'
      ? touchChannel(input.primaryChannel, input.requestedAt)
      : transitionChannelState(input.primaryChannel, 'pending_provisioning', input.requestedAt);

  return {
    agent,
    primaryChannel: {
      ...primaryChannel,
      lastRecoveryRequestedAt: input.requestedAt,
      provisioningStartedAt: null,
      recoveryAttemptCount: input.primaryChannel.recoveryAttemptCount + 1,
      updatedAt: input.requestedAt,
    },
  };
}

export function isAgentOperational(agent: Agent): boolean {
  return agent.lifecycleState === 'active' && agent.provisioningState === 'active';
}

export function createTelegramConversationUrl(externalHandle?: string): string | undefined {
  if (!externalHandle) {
    return undefined;
  }

  const normalizedHandle = externalHandle.replace(/^@+/, '').trim();
  if (normalizedHandle.length === 0) {
    return undefined;
  }

  return `https://t.me/${normalizedHandle}`;
}

import type { AdminAgentSummary, Agent, ChannelState } from '@echidna-claw/contracts';

import { humanizeEnumValue } from '../../lib/formatting/status.js';

type BadgeTone = 'blue' | 'gray' | 'orange' | 'red' | 'teal';
type ChannelViewState = ChannelState | 'missing';

export type AgentViewModel = {
  botIdentity: string | null;
  canRetryProvisioning: boolean;
  channelLabel: string;
  channelTone: BadgeTone;
  conversationReason: string;
  conversationUrl: string | null;
  createdAt: string;
  headModel: string;
  id: string;
  isArchived: boolean;
  lastProvisioningErrorMessage: string | null;
  lifecycleLabel: string;
  lifecycleState: Agent['lifecycleState'];
  lifecycleTone: BadgeTone;
  name: string;
  provisioningLabel: string;
  provisioningState: Agent['provisioningState'];
  provisioningTone: BadgeTone;
  recoverySummary: string | null;
  retryProvisioningReason: string;
  timeZone: string;
  updatedAt: string;
};

const lifecycleToneMap: Record<Agent['lifecycleState'], BadgeTone> = {
  active: 'teal',
  soft_deleted: 'gray',
};

const provisioningToneMap: Record<Agent['provisioningState'], BadgeTone> = {
  active: 'teal',
  pending_provisioning: 'orange',
  provisioning: 'blue',
  provisioning_failed: 'red',
};

const channelToneMap: Record<ChannelViewState, BadgeTone> = {
  active: 'teal',
  missing: 'red',
  pending_provisioning: 'orange',
  provisioning: 'blue',
  provisioning_failed: 'red',
  retired: 'gray',
};

function formatBotIdentity(agent: AdminAgentSummary): string | null {
  const primaryChannel = agent.primaryChannel;
  if (!primaryChannel) {
    return null;
  }

  const handle = primaryChannel.externalHandle
    ? `@${primaryChannel.externalHandle.replace(/^@+/, '')}`
    : null;

  if (primaryChannel.botDisplayName && handle) {
    return `${primaryChannel.botDisplayName} (${handle})`;
  }

  if (primaryChannel.botDisplayName) {
    return primaryChannel.botDisplayName;
  }

  if (handle) {
    return handle;
  }

  return primaryChannel.botUserId ?? null;
}

function getRetryState(agent: AdminAgentSummary): {
  canRetryProvisioning: boolean;
  retryProvisioningReason: string;
} {
  if (!agent.primaryChannel) {
    return {
      canRetryProvisioning: false,
      retryProvisioningReason: 'Primary channel data is unavailable.',
    };
  }

  if (agent.agent.lifecycleState === 'soft_deleted') {
    return {
      canRetryProvisioning: false,
      retryProvisioningReason: 'Restore the agent before retrying provisioning.',
    };
  }

  if (agent.primaryChannel.state !== 'provisioning_failed') {
    return {
      canRetryProvisioning: false,
      retryProvisioningReason: 'Retry is available only after primary-channel provisioning fails.',
    };
  }

  return {
    canRetryProvisioning: true,
    retryProvisioningReason: 'Retry provisioning',
  };
}

function getConversationState(agent: AdminAgentSummary): {
  conversationReason: string;
  conversationUrl: string | null;
} {
  if (agent.agent.lifecycleState === 'soft_deleted') {
    return {
      conversationReason: 'Restore the agent before opening its Telegram conversation.',
      conversationUrl: null,
    };
  }

  if (!agent.primaryChannel) {
    return {
      conversationReason: 'Primary channel data is unavailable.',
      conversationUrl: null,
    };
  }

  if (!agent.primaryChannel.conversationUrl) {
    return {
      conversationReason: 'Jump-to-conversation becomes available once Telegram binding exposes a handle.',
      conversationUrl: null,
    };
  }

  return {
    conversationReason: 'Open Telegram conversation',
    conversationUrl: agent.primaryChannel.conversationUrl,
  };
}

function getRecoverySummary(agent: AdminAgentSummary): string | null {
  if (!agent.primaryChannel || agent.primaryChannel.recoveryAttemptCount === 0) {
    return null;
  }

  return `Retry requests: ${agent.primaryChannel.recoveryAttemptCount}`;
}

export function toAgentViewModel(agent: AdminAgentSummary): AgentViewModel {
  const retryState = getRetryState(agent);
  const conversationState = getConversationState(agent);
  const channelState = agent.primaryChannel?.state ?? 'missing';

  return {
    botIdentity: formatBotIdentity(agent),
    canRetryProvisioning: retryState.canRetryProvisioning,
    channelLabel:
      channelState === 'missing' ? 'Missing primary channel' : humanizeEnumValue(channelState),
    channelTone: channelToneMap[channelState] ?? 'gray',
    conversationReason: conversationState.conversationReason,
    conversationUrl: conversationState.conversationUrl,
    createdAt: agent.agent.createdAt,
    headModel: agent.agent.headModel,
    id: agent.agent.id,
    isArchived: agent.agent.lifecycleState === 'soft_deleted',
    lastProvisioningErrorMessage: agent.primaryChannel?.lastProvisioningErrorMessage ?? null,
    lifecycleLabel: humanizeEnumValue(agent.agent.lifecycleState),
    lifecycleState: agent.agent.lifecycleState,
    lifecycleTone: lifecycleToneMap[agent.agent.lifecycleState] ?? 'gray',
    name: agent.agent.name,
    provisioningLabel: humanizeEnumValue(agent.agent.provisioningState),
    provisioningState: agent.agent.provisioningState,
    provisioningTone: provisioningToneMap[agent.agent.provisioningState] ?? 'orange',
    recoverySummary: getRecoverySummary(agent),
    retryProvisioningReason: retryState.retryProvisioningReason,
    timeZone: agent.agent.timeZone,
    updatedAt: agent.agent.updatedAt,
  };
}

import type { AdminAgentDetail, AdminAgentSummary, Agent, ChannelState } from '@echidna-claw/contracts';

import { formatDateTime } from '../../lib/formatting/dates.js';
import { humanizeEnumValue } from '../../lib/formatting/status.js';

type BadgeTone = 'blue' | 'gray' | 'orange' | 'red' | 'teal';
type ChannelViewState = ChannelState | 'missing';

export type AgentDetailField = {
  label: string;
  monospace?: boolean;
  tone?: 'default' | 'danger' | 'muted';
  value: string;
};

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

export type AgentDetailViewModel = AgentViewModel & {
  archivedNotice: string | null;
  channelIdentityFields: AgentDetailField[];
  credentialStatusBadgeTone: BadgeTone;
  credentialStatusLabel: string;
  lifecycleTimelineFields: AgentDetailField[];
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

function createField(
  label: string,
  value: string | null | undefined,
  options: {
    fallback?: string;
    monospace?: boolean;
    tone?: AgentDetailField['tone'];
  } = {},
): AgentDetailField {
  return {
    label,
    ...(options.monospace ? { monospace: true } : {}),
    ...(options.tone ? { tone: options.tone } : {}),
    value: value && value.trim().length > 0 ? value : options.fallback ?? 'Not available yet',
  };
}

export function toAgentDetailViewModel(agent: AdminAgentDetail): AgentDetailViewModel {
  const summary = toAgentViewModel(agent);
  const primaryChannel = agent.primaryChannel;

  return {
    ...summary,
    archivedNotice: summary.isArchived
      ? 'This agent is archived. Provisioning history and analytics remain visible, but active-use actions stay disabled until you restore it.'
      : null,
    channelIdentityFields: [
      createField('Provider', primaryChannel?.provider ? humanizeEnumValue(primaryChannel.provider) : null, {
        fallback: 'Primary channel missing',
      }),
      createField(
        'Bot handle',
        primaryChannel?.externalHandle ? `@${primaryChannel.externalHandle.replace(/^@+/, '')}` : null,
      ),
      createField('Bot display name', primaryChannel?.botDisplayName),
      createField('Bot user ID', primaryChannel?.botUserId, { monospace: true }),
      createField('Bound chat ID', primaryChannel?.externalChatId, { monospace: true }),
      createField(
        'Credential binding',
        primaryChannel?.credentialId
          ? `Bound credential ${primaryChannel.credentialId}`
          : 'No Telegram bot credential is currently bound.',
        {
          monospace: primaryChannel?.credentialId != null,
          tone: primaryChannel?.credentialId ? 'default' : 'danger',
        },
      ),
    ],
    credentialStatusBadgeTone: primaryChannel?.credentialId ? 'teal' : 'orange',
    credentialStatusLabel: primaryChannel?.credentialId ? 'Credential bound' : 'Credential missing',
    lifecycleTimelineFields: [
      createField('Requested', formatDateTime(primaryChannel?.provisioningRequestedAt ?? null)),
      createField('Started', formatDateTime(primaryChannel?.provisioningStartedAt ?? null)),
      createField('Bound', formatDateTime(primaryChannel?.boundAt ?? null)),
      createField('Last failure', formatDateTime(primaryChannel?.lastProvisioningFailedAt ?? null), {
        tone: primaryChannel?.lastProvisioningFailedAt ? 'danger' : 'muted',
      }),
      createField('Last recovery request', formatDateTime(primaryChannel?.lastRecoveryRequestedAt ?? null)),
      createField(
        'Recovery attempts',
        String(primaryChannel?.recoveryAttemptCount ?? 0),
        {
          tone: (primaryChannel?.recoveryAttemptCount ?? 0) > 0 ? 'default' : 'muted',
        },
      ),
    ],
  };
}

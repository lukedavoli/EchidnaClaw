import type { Agent } from '@echidna-claw/contracts';

import { humanizeEnumValue } from '../../lib/formatting/status.js';

type BadgeTone = 'blue' | 'gray' | 'orange' | 'red' | 'teal';

export type AgentViewModel = {
  createdAt: string;
  headModel: string;
  id: string;
  isArchived: boolean;
  lifecycleLabel: string;
  lifecycleState: Agent['lifecycleState'];
  lifecycleTone: BadgeTone;
  name: string;
  provisioningLabel: string;
  provisioningState: Agent['provisioningState'];
  provisioningTone: BadgeTone;
  reservedConversationReason: string;
  reservedRetryReason: string;
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

export function toAgentViewModel(agent: Agent): AgentViewModel {
  return {
    createdAt: agent.createdAt,
    headModel: agent.headModel,
    id: agent.id,
    isArchived: agent.lifecycleState === 'soft_deleted',
    lifecycleLabel: humanizeEnumValue(agent.lifecycleState),
    lifecycleState: agent.lifecycleState,
    lifecycleTone: lifecycleToneMap[agent.lifecycleState] ?? 'gray',
    name: agent.name,
    provisioningLabel: humanizeEnumValue(agent.provisioningState),
    provisioningState: agent.provisioningState,
    provisioningTone: provisioningToneMap[agent.provisioningState] ?? 'orange',
    reservedConversationReason: 'Jump-to-conversation stays disabled until channel metadata exists.',
    reservedRetryReason: 'Retry provisioning becomes available once recovery APIs land.',
    timeZone: agent.timeZone,
    updatedAt: agent.updatedAt,
  };
}

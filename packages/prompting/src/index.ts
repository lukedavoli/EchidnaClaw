import type {
  Agent,
  CapabilityRegistryEntry,
  HeadTrigger,
  RepositoryConfig,
  WorkingContext,
} from '@echidna-claw/contracts';

import { renderAgentGuidanceLayer } from './layers/agent-guidance.js';
import {
  buildCapabilitySummary,
  renderCapabilitySkillLayer,
} from './layers/capability-skill.js';
import {
  type PromptDurableMemoryItem,
  renderDurableMemoryLayer,
} from './layers/durable-memory.js';
import { renderEchidnaBaseProfileLayer } from './layers/echidna-base-profile.js';
import { renderMemoryPolicyLayer } from './layers/memory-policy.js';
import { renderPlatformPolicyLayer } from './layers/platform-policy.js';
import {
  type DueTaskPromptContext,
  type PromptToolDescriptor,
  renderTurnContextLayer,
} from './layers/turn-context.js';
import { renderTrustedChannelLayer } from './layers/trusted-channel.js';
import { shouldIncludeCapabilitySkill } from './intents/capability-intent.js';
import { HEAD_BASE_PROMPT_PROFILE_VERSION } from './profile/versions.js';

export type HeadPromptLayer = {
  key: string;
  text: string;
};

export type HeadPromptAssembly = {
  includedCapabilitySkill: boolean;
  instructions: string;
  layers: HeadPromptLayer[];
  promptProfileVersion: string;
  visibleCapabilityIds: string[];
};

export type HeadPromptInput = {
  agent: Agent;
  alwaysVisibleCapabilityIds?: readonly string[];
  durableMemories?: readonly PromptDurableMemoryItem[];
  dueTaskContext?: DueTaskPromptContext;
  enabledTools: readonly PromptToolDescriptor[];
  latestTrustedMessageText?: string | null;
  repositoryConfig: RepositoryConfig;
  runtimeMode: 'local-minimal' | 'shared-cloud' | 'cloud-deployed';
  trustedChannel?: {
    externalHandle?: string | null;
    provider: 'telegram';
  } | null;
  trigger: HeadTrigger;
  webSearchEnabled: boolean;
  workingContext: WorkingContext;
};

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function deriveVisibleCapabilityIds(input: {
  alwaysVisibleCapabilityIds?: readonly string[] | undefined;
  registry: readonly CapabilityRegistryEntry[];
}): string[] {
  const visible = input.alwaysVisibleCapabilityIds ?? [];
  const knownIds = new Set(input.registry.map((entry) => entry.id));

  return uniqueSorted(visible.filter((id) => knownIds.has(id)));
}

export function buildHeadPrompt(input: HeadPromptInput): HeadPromptAssembly {
  const visibleCapabilityIds = deriveVisibleCapabilityIds({
    alwaysVisibleCapabilityIds: input.alwaysVisibleCapabilityIds,
    registry: input.repositoryConfig.capabilities.registry,
  });
  const includeCapabilitySkill = shouldIncludeCapabilitySkill({
    latestTrustedMessageText: input.latestTrustedMessageText,
    triggerKind: input.trigger.kind,
  });
  const layers: HeadPromptLayer[] = [
    {
      key: 'platform_policy',
      text: renderPlatformPolicyLayer(),
    },
    {
      key: 'echidna_base_profile',
      text: renderEchidnaBaseProfileLayer(),
    },
    {
      key: 'trusted_channel',
      text: renderTrustedChannelLayer({
        externalHandle: input.trustedChannel?.externalHandle,
        provider: input.trustedChannel?.provider ?? 'telegram',
      }),
    },
  ];

  if (includeCapabilitySkill) {
    layers.push({
      key: 'capability_skill',
      text: renderCapabilitySkillLayer({
        enabledToolNames: input.enabledTools.map((tool) => tool.name),
        registry: input.repositoryConfig.capabilities.registry,
        visibleCapabilityIds,
      }),
    });
  }

  layers.push(
    {
      key: 'agent_guidance',
      text: renderAgentGuidanceLayer(input.agent),
    },
    {
      key: 'memory_policy',
      text: renderMemoryPolicyLayer(input.repositoryConfig),
    },
    {
      key: 'durable_memory',
      text: renderDurableMemoryLayer(input.durableMemories ?? []),
    },
    {
      key: 'turn_context',
      text: renderTurnContextLayer({
        enabledTools: input.enabledTools,
        latestTrustedMessageText: input.latestTrustedMessageText,
        runtimeMode: input.runtimeMode,
        trigger: input.trigger,
        webSearchEnabled: input.webSearchEnabled,
        workingContext: input.workingContext,
        ...(input.dueTaskContext ? { dueTaskContext: input.dueTaskContext } : {}),
      }),
    },
  );

  return {
    includedCapabilitySkill: includeCapabilitySkill,
    instructions: layers.map((layer) => layer.text.trim()).join('\n\n'),
    layers,
    promptProfileVersion: HEAD_BASE_PROMPT_PROFILE_VERSION,
    visibleCapabilityIds,
  };
}

export {
  buildCapabilitySummary,
  HEAD_BASE_PROMPT_PROFILE_VERSION,
  shouldIncludeCapabilitySkill,
};
export type { DueTaskPromptContext, PromptDurableMemoryItem, PromptToolDescriptor };

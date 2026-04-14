import { describe, expect, it } from 'vitest';

import { buildHeadPrompt, buildCapabilitySummary } from '../src/index.js';

const repositoryConfig = {
  version: '1' as const,
  models: {
    defaultModel: 'gpt-5.4-mini' as const,
    pricing: [
      {
        model: 'gpt-5.4-mini' as const,
        provider: 'azure-foundry' as const,
        effectiveAt: '2026-04-12T00:00:00.000Z',
        unit: '1m_tokens' as const,
        inputUsd: 0.2,
        outputUsd: 0.8,
      },
    ],
  },
  agents: {
    factoryProfile: {
      version: 'factory-v1',
      defaultTimeZone: 'Australia/Sydney',
      initialResponsibilitiesSummary: 'Shared operator profile.',
    },
  },
  sandbox: {
    defaultPolicy: 'standard',
    policies: [
      {
        name: 'standard',
        description: 'Default policy.',
        allowFilesystemWriteUnder: ['/workspace'],
        allowOutboundHosts: ['api.telegram.org'],
        allowCommands: ['pnpm'],
      },
    ],
    packageAllowlists: [
      {
        name: 'default-runtime',
        packages: ['zod'],
      },
    ],
  },
  capabilities: {
    registry: [
      {
        id: 'telegram.messaging',
        name: 'Telegram direct messaging',
        description: 'Sends and receives Telegram direct-message traffic.',
        category: 'channel' as const,
      },
      {
        id: 'sandbox.shell',
        name: 'Sandbox shell execution',
        description: 'Runs commands in the sandbox.',
        category: 'tool' as const,
      },
    ],
  },
};

const agent = {
  id: 'agt_prompt',
  recordType: 'agent' as const,
  schemaVersion: 1 as const,
  createdAt: '2026-04-12T00:00:00.000Z',
  updatedAt: '2026-04-12T00:00:00.000Z',
  correlation: {
    traceId: 'trc_prompt',
    idempotencyKey: 'idem_prompt',
  },
  name: 'Prompt Agent',
  timeZone: 'Australia/Sydney',
  headModel: 'gpt-5.4-mini' as const,
  primaryChannelId: 'chn_prompt',
  provisioningState: 'active' as const,
  lifecycleState: 'active' as const,
  softDeletedAt: null,
  restoredAt: null,
  factoryProfileVersion: 'factory-v1',
  responsibilitiesSummary: 'Handle operational follow-ups.',
};

const workingContext = {
  id: 'ctx_prompt',
  recordType: 'working_context' as const,
  schemaVersion: 1 as const,
  createdAt: '2026-04-12T00:00:00.000Z',
  updatedAt: '2026-04-12T00:00:00.000Z',
  correlation: {
    traceId: 'trc_prompt',
    idempotencyKey: 'idem_prompt',
  },
  agentId: 'agt_prompt',
  latestInboundSequence: 1,
  latestProcessedSequence: 1,
  activeHeadTurnId: null,
  activeHeadTurnStartedAt: null,
  activeHeadTurnReadThroughSequence: null,
  pendingSupersededBySequence: null,
  debounceUntil: null,
  pendingDebounceSequence: null,
  episodeLocalDate: '2026-04-12',
  episodeTurnCount: 1,
  activeTaskId: null,
  summary: 'Watching deployment health.',
  summaryUpdatedAt: '2026-04-12T00:00:00.000Z',
  currentObjective: 'Confirm deployment health.',
  latestHandsStatus: null,
  openQuestions: [],
  conversationCursor: undefined,
  openTaskIds: [],
  pendingApprovalIds: [],
};

describe('@echidna-claw/prompting', () => {
  it('includes the capability layer only for capability-seeking trusted messages', () => {
    const prompt = buildHeadPrompt({
      agent,
      alwaysVisibleCapabilityIds: ['telegram.messaging'],
      enabledTools: [
        {
          description: 'Summarize current runtime state.',
          name: 'read_status',
        },
      ],
      latestTrustedMessageText: 'What can you do for me right now?',
      repositoryConfig,
      runtimeMode: 'local-minimal',
      trustedChannel: {
        externalHandle: '@echidna_ops',
        provider: 'telegram',
      },
      trigger: {
        kind: 'trusted_messages',
        channelId: 'chn_prompt',
        inboundMessageIds: ['inm_prompt'],
        readThroughMessageSequence: 1,
      },
      webSearchEnabled: true,
      workingContext,
    });

    expect(prompt.includedCapabilitySkill).toBe(true);
    expect(prompt.instructions).toContain('# Capability Skill');
    expect(prompt.instructions).toContain('Telegram direct messaging');
    expect(prompt.instructions).not.toContain('Sandbox shell execution');
  });

  it('keeps the capability layer out of ordinary due-task turns', () => {
    const prompt = buildHeadPrompt({
      agent,
      alwaysVisibleCapabilityIds: ['telegram.messaging'],
      enabledTools: [],
      latestTrustedMessageText: null,
      repositoryConfig,
      runtimeMode: 'local-minimal',
      trigger: {
        kind: 'due_task',
        dueAt: '2026-04-13T09:00:00.000Z',
        taskId: 'tsk_prompt',
      },
      webSearchEnabled: false,
      workingContext,
    });

    expect(prompt.includedCapabilitySkill).toBe(false);
    expect(prompt.instructions).not.toContain('# Capability Skill');
  });

  it('renders conservative capability summaries from visible registry entries only', () => {
    expect(
      buildCapabilitySummary({
        enabledToolNames: ['read_status'],
        registry: repositoryConfig.capabilities.registry,
        visibleCapabilityIds: ['telegram.messaging'],
      }),
    ).toContain('Telegram direct messaging');
  });
});

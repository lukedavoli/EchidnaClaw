import {
  agentSchema,
  channelSchema,
  type Agent,
  type AgentId,
  type Channel,
  type PlatformRecord,
} from '@echidna-claw/contracts';

import { type StoredRecord } from '../documents/envelope.js';
import { type AgentRepository } from './agent-repository.js';
import { type ChannelRepository } from './channel-repository.js';
import { type PersistedRecordStore } from './store.js';

export type AgentRegistryEntry = {
  agent: StoredRecord<Agent>;
  primaryChannel: StoredRecord<Channel> | null;
};

export type WritableAgentRegistryEntry = {
  agent: Agent;
  agentEtag: string;
  primaryChannel: Channel;
  primaryChannelEtag: string;
};

export interface AgentRegistryRepository {
  completeProvisioning(input: WritableAgentRegistryEntry): Promise<AgentRegistryEntry>;
  createRegistryEntry(input: {
    agent: Agent;
    primaryChannel: Channel;
  }): Promise<AgentRegistryEntry>;
  getRegistryEntry(agentId: AgentId): Promise<AgentRegistryEntry | null>;
  listRegistryEntries(): Promise<AgentRegistryEntry[]>;
  recordProvisioningFailure(input: WritableAgentRegistryEntry): Promise<AgentRegistryEntry>;
  restore(input: WritableAgentRegistryEntry): Promise<AgentRegistryEntry>;
  retryProvisioning(input: WritableAgentRegistryEntry): Promise<AgentRegistryEntry>;
  softDelete(input: WritableAgentRegistryEntry): Promise<AgentRegistryEntry>;
}

function asStoredAgent(record: StoredRecord<PlatformRecord>): StoredRecord<Agent> {
  return {
    etag: record.etag,
    value: agentSchema.parse(record.value),
  };
}

function asStoredChannel(record: StoredRecord<PlatformRecord>): StoredRecord<Channel> {
  return {
    etag: record.etag,
    value: channelSchema.parse(record.value),
  };
}

export class DefaultAgentRegistryRepository implements AgentRegistryRepository {
  constructor(
    private readonly store: PersistedRecordStore,
    private readonly agents: AgentRepository,
    private readonly channels: ChannelRepository,
  ) {}

  private async replaceRegistryEntry(input: WritableAgentRegistryEntry): Promise<AgentRegistryEntry> {
    const [agent, primaryChannel] = await this.store.batch(input.agent.id, [
      {
        kind: 'replace',
        record: agentSchema.parse(input.agent),
        expectedEtag: input.agentEtag,
      },
      {
        kind: 'replace',
        record: channelSchema.parse(input.primaryChannel),
        expectedEtag: input.primaryChannelEtag,
      },
    ]);

    if (!agent || !primaryChannel) {
      throw new Error('Registry batch replace did not return both the agent and primary channel.');
    }

    return {
      agent: asStoredAgent(agent),
      primaryChannel: asStoredChannel(primaryChannel),
    };
  }

  async createRegistryEntry(input: {
    agent: Agent;
    primaryChannel: Channel;
  }): Promise<AgentRegistryEntry> {
    const [agent, primaryChannel] = await this.store.batch(input.agent.id, [
      {
        kind: 'create',
        record: agentSchema.parse(input.agent),
      },
      {
        kind: 'create',
        record: channelSchema.parse(input.primaryChannel),
      },
    ]);

    if (!agent || !primaryChannel) {
      throw new Error('Registry batch create did not return both the agent and primary channel.');
    }

    return {
      agent: asStoredAgent(agent),
      primaryChannel: asStoredChannel(primaryChannel),
    };
  }

  async getRegistryEntry(agentId: AgentId): Promise<AgentRegistryEntry | null> {
    const agent = await this.agents.get(agentId);
    if (!agent) {
      return null;
    }

    const primaryChannel = await this.channels.get(agentId, agent.value.primaryChannelId);

    return {
      agent,
      primaryChannel,
    };
  }

  async listRegistryEntries(): Promise<AgentRegistryEntry[]> {
    const agents = await this.agents.list();
    const channelsByAgent = new Map<
      AgentId,
      Awaited<ReturnType<ChannelRepository['listByAgent']>>
    >();

    await Promise.all(
      agents.map(async (agent) => {
        channelsByAgent.set(agent.value.id, await this.channels.listByAgent(agent.value.id));
      }),
    );

    return agents.map((agent) => ({
      agent,
      primaryChannel:
        channelsByAgent
          .get(agent.value.id)
          ?.find((channel) => channel.value.id === agent.value.primaryChannelId) ?? null,
    }));
  }

  async softDelete(input: WritableAgentRegistryEntry): Promise<AgentRegistryEntry> {
    return this.replaceRegistryEntry(input);
  }

  async restore(input: WritableAgentRegistryEntry): Promise<AgentRegistryEntry> {
    return this.replaceRegistryEntry(input);
  }

  async retryProvisioning(input: WritableAgentRegistryEntry): Promise<AgentRegistryEntry> {
    return this.replaceRegistryEntry(input);
  }

  async completeProvisioning(input: WritableAgentRegistryEntry): Promise<AgentRegistryEntry> {
    return this.replaceRegistryEntry(input);
  }

  async recordProvisioningFailure(input: WritableAgentRegistryEntry): Promise<AgentRegistryEntry> {
    return this.replaceRegistryEntry(input);
  }
}

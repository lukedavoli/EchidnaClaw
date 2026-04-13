import {
  channelSchema,
  type AgentId,
  type Channel,
  type ChannelId,
} from '@echidna-claw/contracts';

import { type StoredRecord } from '../documents/envelope.js';
import { eq, operationalContainerName } from './common.js';
import { type PersistedRecordStore } from './store.js';

export interface ChannelRepository {
  create(channel: Channel): Promise<StoredRecord<Channel>>;
  getById(channelId: ChannelId): Promise<StoredRecord<Channel> | null>;
  get(agentId: AgentId, channelId: ChannelId): Promise<StoredRecord<Channel> | null>;
  listByAgent(agentId: AgentId): Promise<StoredRecord<Channel>[]>;
  findByExternalIdentity(input: {
    provider: Channel['provider'];
    externalChatId?: string;
    externalHandle?: string;
  }): Promise<StoredRecord<Channel> | null>;
  replace(channel: Channel, expectedEtag: string): Promise<StoredRecord<Channel>>;
}

export class DefaultChannelRepository implements ChannelRepository {
  constructor(private readonly store: PersistedRecordStore) {}

  async create(channel: Channel): Promise<StoredRecord<Channel>> {
    return this.store.create(channelSchema.parse(channel));
  }

  async getById(channelId: ChannelId): Promise<StoredRecord<Channel> | null> {
    const results = await this.store.query({
      containerName: operationalContainerName,
      schema: channelSchema,
      where: [eq('recordType', 'channel'), eq('id', channelId)],
      limit: 1,
    });

    return results[0] ?? null;
  }

  async get(agentId: AgentId, channelId: ChannelId): Promise<StoredRecord<Channel> | null> {
    return this.store.get(channelId, agentId, channelSchema);
  }

  async listByAgent(agentId: AgentId): Promise<StoredRecord<Channel>[]> {
    return this.store.query({
      containerName: operationalContainerName,
      partitionKey: agentId,
      schema: channelSchema,
      where: [eq('recordType', 'channel')],
      orderBy: [{ field: 'createdAt', direction: 'asc' }],
    });
  }

  async findByExternalIdentity(input: {
    provider: Channel['provider'];
    externalChatId?: string;
    externalHandle?: string;
  }): Promise<StoredRecord<Channel> | null> {
    const where = [eq('recordType', 'channel'), eq('provider', input.provider)];

    if (input.externalChatId) {
      where.push(eq('externalChatId', input.externalChatId));
    }

    if (input.externalHandle) {
      where.push(eq('externalHandle', input.externalHandle));
    }

    const results = await this.store.query({
      containerName: operationalContainerName,
      schema: channelSchema,
      where,
      limit: 1,
    });

    return results[0] ?? null;
  }

  async replace(channel: Channel, expectedEtag: string): Promise<StoredRecord<Channel>> {
    return this.store.replace(channelSchema.parse(channel), expectedEtag);
  }
}

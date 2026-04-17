import {
  telegramProvisioningSessionSchema,
  type AgentId,
  type ChannelId,
  type TelegramProvisioningSession,
  type TelegramProvisioningSessionId,
} from '@echidna-claw/contracts';

import { type StoredRecord } from '../documents/envelope.js';
import { eq, inList, operationalContainerName } from './common.js';
import { type PersistedRecordStore } from './store.js';

const activeSessionStates: TelegramProvisioningSession['state'][] = [
  'pending_operator_action',
  'verifying_token',
  'awaiting_operator_binding',
];

export interface TelegramProvisioningSessionRepository {
  create(
    session: TelegramProvisioningSession,
  ): Promise<StoredRecord<TelegramProvisioningSession>>;
  get(
    agentId: AgentId,
    sessionId: TelegramProvisioningSessionId,
  ): Promise<StoredRecord<TelegramProvisioningSession> | null>;
  getLatestByAgent(
    agentId: AgentId,
  ): Promise<StoredRecord<TelegramProvisioningSession> | null>;
  getLatestByChannel(
    channelId: ChannelId,
  ): Promise<StoredRecord<TelegramProvisioningSession> | null>;
  getActiveByChannel(
    channelId: ChannelId,
  ): Promise<StoredRecord<TelegramProvisioningSession> | null>;
  replace(
    session: TelegramProvisioningSession,
    expectedEtag: string,
  ): Promise<StoredRecord<TelegramProvisioningSession>>;
}

export class DefaultTelegramProvisioningSessionRepository
  implements TelegramProvisioningSessionRepository
{
  constructor(private readonly store: PersistedRecordStore) {}

  async create(
    session: TelegramProvisioningSession,
  ): Promise<StoredRecord<TelegramProvisioningSession>> {
    return this.store.create(telegramProvisioningSessionSchema.parse(session));
  }

  async get(
    agentId: AgentId,
    sessionId: TelegramProvisioningSessionId,
  ): Promise<StoredRecord<TelegramProvisioningSession> | null> {
    return this.store.get(sessionId, agentId, telegramProvisioningSessionSchema);
  }

  async getLatestByAgent(
    agentId: AgentId,
  ): Promise<StoredRecord<TelegramProvisioningSession> | null> {
    const results = await this.store.query({
      containerName: operationalContainerName,
      partitionKey: agentId,
      schema: telegramProvisioningSessionSchema,
      where: [eq('recordType', 'telegram_provisioning_session')],
      orderBy: [{ field: 'attemptNumber', direction: 'desc' }],
      limit: 1,
    });

    return results[0] ?? null;
  }

  async getLatestByChannel(
    channelId: ChannelId,
  ): Promise<StoredRecord<TelegramProvisioningSession> | null> {
    const results = await this.store.query({
      containerName: operationalContainerName,
      schema: telegramProvisioningSessionSchema,
      where: [
        eq('recordType', 'telegram_provisioning_session'),
        eq('channelId', channelId),
      ],
      orderBy: [{ field: 'attemptNumber', direction: 'desc' }],
      limit: 1,
    });

    return results[0] ?? null;
  }

  async getActiveByChannel(
    channelId: ChannelId,
  ): Promise<StoredRecord<TelegramProvisioningSession> | null> {
    const results = await this.store.query({
      containerName: operationalContainerName,
      schema: telegramProvisioningSessionSchema,
      where: [
        eq('recordType', 'telegram_provisioning_session'),
        eq('channelId', channelId),
        inList('state', activeSessionStates),
      ],
      orderBy: [{ field: 'attemptNumber', direction: 'desc' }],
      limit: 1,
    });

    return results[0] ?? null;
  }

  async replace(
    session: TelegramProvisioningSession,
    expectedEtag: string,
  ): Promise<StoredRecord<TelegramProvisioningSession>> {
    return this.store.replace(telegramProvisioningSessionSchema.parse(session), expectedEtag);
  }
}

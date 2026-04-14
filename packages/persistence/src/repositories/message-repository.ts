import {
  channelSchema,
  idempotencyRecordSchema,
  inboundMessageSchema,
  outboundMessageSchema,
  type AgentId,
  type Channel,
  type ChannelId,
  type InboundMessage,
  type InboundMessageId,
  type IdempotencyRecord,
  type OutboundMessage,
  type OutboundMessageId,
} from '@echidna-claw/contracts';
import { z } from 'zod';

import { type StoredRecord } from '../documents/envelope.js';
import { getRequiredRecord, eq, gte, inList, lte, operationalContainerName } from './common.js';
import { DuplicateRecordError } from './errors.js';
import { type PersistedRecordStore } from './store.js';

const messageRecordSchema = z.discriminatedUnion('recordType', [
  inboundMessageSchema,
  outboundMessageSchema,
]);

export interface AppendInboundMessageResult {
  channel: StoredRecord<Channel>;
  idempotencyRecord: StoredRecord<IdempotencyRecord>;
  message: StoredRecord<InboundMessage>;
  replayed: boolean;
}

export interface MessageRepository {
  appendInboundMessage(input: {
    channel: Channel;
    channelEtag: string;
    idempotencyRecord: IdempotencyRecord;
    message: InboundMessage;
  }): Promise<AppendInboundMessageResult>;
  createOutboundMessage(message: OutboundMessage): Promise<StoredRecord<OutboundMessage>>;
  saveOutboundDelivery(input: {
    channel?: Channel;
    channelEtag?: string;
    message: OutboundMessage;
    messageEtag: string;
  }): Promise<{
    channel: StoredRecord<Channel> | null;
    message: StoredRecord<OutboundMessage>;
  }>;
  getInboundMessage(agentId: AgentId, inboundMessageId: InboundMessageId): Promise<StoredRecord<InboundMessage> | null>;
  getOutboundMessage(
    agentId: AgentId,
    outboundMessageId: OutboundMessageId,
  ): Promise<StoredRecord<OutboundMessage> | null>;
  listTrustedInboundMessagesBySequenceRange(input: {
    agentId: AgentId;
    channelId: ChannelId;
    fromSequence: number;
    throughSequence: number;
  }): Promise<StoredRecord<InboundMessage>[]>;
  listRecentMessages(
    agentId: AgentId,
    limit?: number,
  ): Promise<Array<StoredRecord<InboundMessage | OutboundMessage>>>;
}

export class DefaultMessageRepository implements MessageRepository {
  constructor(private readonly store: PersistedRecordStore) {}

  async appendInboundMessage(input: {
    channel: Channel;
    channelEtag: string;
    idempotencyRecord: IdempotencyRecord;
    message: InboundMessage;
  }): Promise<AppendInboundMessageResult> {
    const channel = channelSchema.parse(input.channel);
    const message = inboundMessageSchema.parse(input.message);
    const idempotencyRecord = idempotencyRecordSchema.parse(input.idempotencyRecord);

    try {
      const [storedIdempotency, storedChannel, storedMessage] = await this.store.batch(message.agentId, [
        {
          kind: 'create',
          record: idempotencyRecord,
        },
        {
          kind: 'replace',
          record: channel,
          expectedEtag: input.channelEtag,
        },
        {
          kind: 'create',
          record: message,
        },
      ]);

      return {
        channel: storedChannel as StoredRecord<Channel>,
        idempotencyRecord: storedIdempotency as StoredRecord<IdempotencyRecord>,
        message: storedMessage as StoredRecord<InboundMessage>,
        replayed: false,
      };
    } catch (error) {
      if (!(error instanceof DuplicateRecordError)) {
        throw error;
      }

      const existingIdempotency = await this.store.query({
        containerName: operationalContainerName,
        partitionKey: message.agentId,
        schema: idempotencyRecordSchema,
        where: [
          eq('recordType', 'idempotency_record'),
          eq('scope', idempotencyRecord.scope),
          eq('key', idempotencyRecord.key),
        ],
        limit: 1,
      });

      const replayRecord = existingIdempotency[0];
      if (!replayRecord || replayRecord.value.resultReference !== message.id) {
        throw error;
      }

      const storedMessage = await getRequiredRecord(
        this.getInboundMessage(message.agentId, message.id),
        `Inbound message ${message.id}`,
      );
      const storedChannel = await getRequiredRecord(
        this.store.get(channel.id, channel.agentId, channelSchema),
        `Channel ${channel.id}`,
      );

      return {
        channel: storedChannel,
        idempotencyRecord: replayRecord,
        message: storedMessage,
        replayed: true,
      };
    }
  }

  async createOutboundMessage(message: OutboundMessage): Promise<StoredRecord<OutboundMessage>> {
    return this.store.create(outboundMessageSchema.parse(message));
  }

  async saveOutboundDelivery(input: {
    channel?: Channel;
    channelEtag?: string;
    message: OutboundMessage;
    messageEtag: string;
  }): Promise<{
    channel: StoredRecord<Channel> | null;
    message: StoredRecord<OutboundMessage>;
  }> {
    const message = outboundMessageSchema.parse(input.message);

    if (input.channel == null) {
      const storedMessage = await this.store.replace(message, input.messageEtag);
      return {
        channel: null,
        message: storedMessage,
      };
    }

    if (input.channelEtag == null) {
      throw new Error('channelEtag is required when saving outbound delivery with a channel update.');
    }

    const channel = channelSchema.parse(input.channel);
    const [storedChannel, storedMessage] = await this.store.batch(message.agentId, [
      {
        kind: 'replace',
        record: channel,
        expectedEtag: input.channelEtag,
      },
      {
        kind: 'replace',
        record: message,
        expectedEtag: input.messageEtag,
      },
    ]);

    return {
      channel: storedChannel as StoredRecord<Channel>,
      message: storedMessage as StoredRecord<OutboundMessage>,
    };
  }

  async getInboundMessage(
    agentId: AgentId,
    inboundMessageId: InboundMessageId,
  ): Promise<StoredRecord<InboundMessage> | null> {
    return this.store.get(inboundMessageId, agentId, inboundMessageSchema);
  }

  async getOutboundMessage(
    agentId: AgentId,
    outboundMessageId: OutboundMessageId,
  ): Promise<StoredRecord<OutboundMessage> | null> {
    return this.store.get(outboundMessageId, agentId, outboundMessageSchema);
  }

  async listTrustedInboundMessagesBySequenceRange(input: {
    agentId: AgentId;
    channelId: ChannelId;
    fromSequence: number;
    throughSequence: number;
  }): Promise<StoredRecord<InboundMessage>[]> {
    if (input.fromSequence > input.throughSequence) {
      return [];
    }

    return this.store.query({
      containerName: operationalContainerName,
      partitionKey: input.agentId,
      schema: inboundMessageSchema,
      where: [
        eq('recordType', 'inbound_message'),
        eq('channelId', input.channelId),
        eq('trusted', true),
        gte('sequence', input.fromSequence),
        lte('sequence', input.throughSequence),
      ],
      orderBy: [{ field: 'sequence', direction: 'asc' }],
    });
  }

  async listRecentMessages(
    agentId: AgentId,
    limit = 50,
  ): Promise<Array<StoredRecord<InboundMessage | OutboundMessage>>> {
    return this.store.query({
      containerName: operationalContainerName,
      partitionKey: agentId,
      schema: messageRecordSchema,
      where: [inList('recordType', ['inbound_message', 'outbound_message'])],
      orderBy: [{ field: 'createdAt', direction: 'desc' }],
      limit,
    });
  }
}

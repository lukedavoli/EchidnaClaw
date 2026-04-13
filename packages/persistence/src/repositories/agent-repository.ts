import { agentSchema, type Agent, type AgentId } from '@echidna-claw/contracts';

import { type StoredRecord } from '../documents/envelope.js';
import { eq, operationalContainerName } from './common.js';
import { type PersistedRecordStore } from './store.js';

export interface AgentRepository {
  create(agent: Agent): Promise<StoredRecord<Agent>>;
  get(agentId: AgentId): Promise<StoredRecord<Agent> | null>;
  list(): Promise<StoredRecord<Agent>[]>;
  replace(agent: Agent, expectedEtag: string): Promise<StoredRecord<Agent>>;
}

export class DefaultAgentRepository implements AgentRepository {
  constructor(private readonly store: PersistedRecordStore) {}

  async create(agent: Agent): Promise<StoredRecord<Agent>> {
    return this.store.create(agentSchema.parse(agent));
  }

  async get(agentId: AgentId): Promise<StoredRecord<Agent> | null> {
    return this.store.get(agentId, agentId, agentSchema);
  }

  async list(): Promise<StoredRecord<Agent>[]> {
    return this.store.query({
      containerName: operationalContainerName,
      schema: agentSchema,
      where: [eq('recordType', 'agent')],
      orderBy: [{ field: 'createdAt', direction: 'desc' }],
    });
  }

  async replace(agent: Agent, expectedEtag: string): Promise<StoredRecord<Agent>> {
    return this.store.replace(agentSchema.parse(agent), expectedEtag);
  }
}

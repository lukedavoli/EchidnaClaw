import {
  workingContextSchema,
  type AgentId,
  type WorkingContext,
  type WorkingContextId,
} from '@echidna-claw/contracts';

import { type StoredRecord } from '../documents/envelope.js';
import { eq, operationalContainerName } from './common.js';
import { type PersistedRecordStore } from './store.js';

export interface WorkingContextRepository {
  create(context: WorkingContext): Promise<StoredRecord<WorkingContext>>;
  get(agentId: AgentId, workingContextId: WorkingContextId): Promise<StoredRecord<WorkingContext> | null>;
  getByAgent(agentId: AgentId): Promise<StoredRecord<WorkingContext> | null>;
  replace(context: WorkingContext, expectedEtag: string): Promise<StoredRecord<WorkingContext>>;
}

export class DefaultWorkingContextRepository implements WorkingContextRepository {
  constructor(private readonly store: PersistedRecordStore) {}

  async create(context: WorkingContext): Promise<StoredRecord<WorkingContext>> {
    return this.store.create(workingContextSchema.parse(context));
  }

  async get(
    agentId: AgentId,
    workingContextId: WorkingContextId,
  ): Promise<StoredRecord<WorkingContext> | null> {
    return this.store.get(workingContextId, agentId, workingContextSchema);
  }

  async getByAgent(agentId: AgentId): Promise<StoredRecord<WorkingContext> | null> {
    const results = await this.store.query({
      containerName: operationalContainerName,
      partitionKey: agentId,
      schema: workingContextSchema,
      where: [eq('recordType', 'working_context')],
      orderBy: [{ field: 'updatedAt', direction: 'desc' }],
      limit: 1,
    });

    return results[0] ?? null;
  }

  async replace(
    context: WorkingContext,
    expectedEtag: string,
  ): Promise<StoredRecord<WorkingContext>> {
    return this.store.replace(workingContextSchema.parse(context), expectedEtag);
  }
}

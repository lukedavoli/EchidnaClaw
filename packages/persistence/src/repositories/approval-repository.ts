import {
  approvalSchema,
  taskSchema,
  type AgentId,
  type Approval,
  type ApprovalId,
  type Task,
} from '@echidna-claw/contracts';

import { type StoredRecord } from '../documents/envelope.js';
import { assertSameAgent, eq, operationalContainerName } from './common.js';
import { type PersistedRecordStore } from './store.js';

export interface ApprovalCreationResult {
  approval: StoredRecord<Approval>;
  task: StoredRecord<Task>;
}

export interface ApprovalRepository {
  create(approval: Approval): Promise<StoredRecord<Approval>>;
  get(agentId: AgentId, approvalId: ApprovalId): Promise<StoredRecord<Approval> | null>;
  replace(approval: Approval, expectedEtag: string): Promise<StoredRecord<Approval>>;
  listPending(agentId?: AgentId): Promise<StoredRecord<Approval>[]>;
  createForTask(input: {
    approval: Approval;
    task: Task;
    taskEtag: string;
  }): Promise<ApprovalCreationResult>;
}

export class DefaultApprovalRepository implements ApprovalRepository {
  constructor(private readonly store: PersistedRecordStore) {}

  async create(approval: Approval): Promise<StoredRecord<Approval>> {
    return this.store.create(approvalSchema.parse(approval));
  }

  async get(agentId: AgentId, approvalId: ApprovalId): Promise<StoredRecord<Approval> | null> {
    return this.store.get(approvalId, agentId, approvalSchema);
  }

  async replace(approval: Approval, expectedEtag: string): Promise<StoredRecord<Approval>> {
    return this.store.replace(approvalSchema.parse(approval), expectedEtag);
  }

  async listPending(agentId?: AgentId): Promise<StoredRecord<Approval>[]> {
    return this.store.query({
      containerName: operationalContainerName,
      ...(agentId ? { partitionKey: agentId } : {}),
      schema: approvalSchema,
      where: [eq('recordType', 'approval'), eq('state', 'requested')],
      orderBy: [{ field: 'requestedAt', direction: 'asc' }],
    });
  }

  async createForTask(input: {
    approval: Approval;
    task: Task;
    taskEtag: string;
  }): Promise<ApprovalCreationResult> {
    const approval = approvalSchema.parse(input.approval);
    const task = taskSchema.parse(input.task);
    assertSameAgent(approval.agentId, [approval, task]);

    const [storedApproval, storedTask] = await this.store.batch(approval.agentId, [
      {
        kind: 'create',
        record: approval,
      },
      {
        kind: 'replace',
        record: task,
        expectedEtag: input.taskEtag,
      },
    ]);

    return {
      approval: storedApproval as StoredRecord<Approval>,
      task: storedTask as StoredRecord<Task>,
    };
  }
}

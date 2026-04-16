import {
  approvalSchema,
  runJournalEntrySchema,
  runJournalSchema,
  taskSchema,
  type AgentId,
  type Approval,
  type ApprovalId,
  type RunJournal,
  type RunJournalEntry,
  type Task,
  type WorkingContext,
  workingContextSchema,
} from '@echidna-claw/contracts';

import { type StoredRecord } from '../documents/envelope.js';
import { assertSameAgent, eq, operationalContainerName } from './common.js';
import { type BatchOperation } from './store.js';
import { type PersistedRecordStore } from './store.js';

export interface ApprovalCreationResult {
  approval: StoredRecord<Approval>;
  task: StoredRecord<Task>;
}

export interface ApprovalLifecycleMutationResult {
  approval: StoredRecord<Approval>;
  runJournal: StoredRecord<RunJournal> | null;
  runJournalEntry: StoredRecord<RunJournalEntry> | null;
  task: StoredRecord<Task>;
  workingContext: StoredRecord<WorkingContext>;
}

export interface ApprovalRepository {
  create(approval: Approval): Promise<StoredRecord<Approval>>;
  get(agentId: AgentId, approvalId: ApprovalId): Promise<StoredRecord<Approval> | null>;
  findById(approvalId: ApprovalId): Promise<StoredRecord<Approval> | null>;
  replace(approval: Approval, expectedEtag: string): Promise<StoredRecord<Approval>>;
  listPending(agentId?: AgentId): Promise<StoredRecord<Approval>[]>;
  createForTask(input: {
    approval: Approval;
    task: Task;
    taskEtag: string;
  }): Promise<ApprovalCreationResult>;
  createBlockingRequest(input: {
    approval: Approval;
    runJournal?: RunJournal;
    runJournalEtag?: string;
    runJournalEntry?: RunJournalEntry;
    task: Task;
    taskEtag: string;
    workingContext: WorkingContext;
    workingContextEtag: string;
  }): Promise<ApprovalLifecycleMutationResult>;
  recordDecision(input: {
    approval: Approval;
    approvalEtag: string;
    runJournal?: RunJournal;
    runJournalEtag?: string;
    runJournalEntry?: RunJournalEntry;
    task: Task;
    taskEtag: string;
    workingContext: WorkingContext;
    workingContextEtag: string;
  }): Promise<ApprovalLifecycleMutationResult>;
}

export class DefaultApprovalRepository implements ApprovalRepository {
  constructor(private readonly store: PersistedRecordStore) {}

  async create(approval: Approval): Promise<StoredRecord<Approval>> {
    return this.store.create(approvalSchema.parse(approval));
  }

  async get(agentId: AgentId, approvalId: ApprovalId): Promise<StoredRecord<Approval> | null> {
    return this.store.get(approvalId, agentId, approvalSchema);
  }

  async findById(approvalId: ApprovalId): Promise<StoredRecord<Approval> | null> {
    const results = await this.store.query({
      containerName: operationalContainerName,
      schema: approvalSchema,
      where: [eq('recordType', 'approval'), eq('id', approvalId)],
      limit: 1,
    });

    return results[0] ?? null;
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

  async createBlockingRequest(input: {
    approval: Approval;
    runJournal?: RunJournal;
    runJournalEtag?: string;
    runJournalEntry?: RunJournalEntry;
    task: Task;
    taskEtag: string;
    workingContext: WorkingContext;
    workingContextEtag: string;
  }): Promise<ApprovalLifecycleMutationResult> {
    const approval = approvalSchema.parse(input.approval);
    const task = taskSchema.parse(input.task);
    const workingContext = workingContextSchema.parse(input.workingContext);
    const runJournal = input.runJournal ? runJournalSchema.parse(input.runJournal) : undefined;
    const runJournalEntry = input.runJournalEntry
      ? runJournalEntrySchema.parse(input.runJournalEntry)
      : undefined;
    assertSameAgent(approval.agentId, [
      approval,
      task,
      workingContext,
      ...(runJournal ? [runJournal] : []),
      ...(runJournalEntry ? [runJournalEntry] : []),
    ]);

    const operations: BatchOperation[] = [
      {
        kind: 'replace',
        record: workingContext,
        expectedEtag: input.workingContextEtag,
      },
      {
        kind: 'replace',
        record: task,
        expectedEtag: input.taskEtag,
      },
      {
        kind: 'create',
        record: approval,
      },
      ...(runJournal
        ? [
            input.runJournalEtag
              ? {
                  kind: 'replace' as const,
                  record: runJournal,
                  expectedEtag: input.runJournalEtag,
                }
              : {
                  kind: 'create' as const,
                  record: runJournal,
                },
          ]
        : []),
      ...(runJournalEntry
        ? [
            {
              kind: 'create' as const,
              record: runJournalEntry,
            },
          ]
        : []),
    ];
    const results = await this.store.batch(approval.agentId, operations);

    return {
      workingContext: results[0] as StoredRecord<WorkingContext>,
      task: results[1] as StoredRecord<Task>,
      approval: results[2] as StoredRecord<Approval>,
      runJournal: runJournal ? (results[3] as StoredRecord<RunJournal>) : null,
      runJournalEntry: runJournalEntry
        ? (results[runJournal ? 4 : 3] as StoredRecord<RunJournalEntry>)
        : null,
    };
  }

  async recordDecision(input: {
    approval: Approval;
    approvalEtag: string;
    runJournal?: RunJournal;
    runJournalEtag?: string;
    runJournalEntry?: RunJournalEntry;
    task: Task;
    taskEtag: string;
    workingContext: WorkingContext;
    workingContextEtag: string;
  }): Promise<ApprovalLifecycleMutationResult> {
    const approval = approvalSchema.parse(input.approval);
    const task = taskSchema.parse(input.task);
    const workingContext = workingContextSchema.parse(input.workingContext);
    const runJournal = input.runJournal ? runJournalSchema.parse(input.runJournal) : undefined;
    const runJournalEntry = input.runJournalEntry
      ? runJournalEntrySchema.parse(input.runJournalEntry)
      : undefined;
    assertSameAgent(approval.agentId, [
      approval,
      task,
      workingContext,
      ...(runJournal ? [runJournal] : []),
      ...(runJournalEntry ? [runJournalEntry] : []),
    ]);

    const operations: BatchOperation[] = [
      {
        kind: 'replace',
        record: workingContext,
        expectedEtag: input.workingContextEtag,
      },
      {
        kind: 'replace',
        record: task,
        expectedEtag: input.taskEtag,
      },
      {
        kind: 'replace',
        record: approval,
        expectedEtag: input.approvalEtag,
      },
      ...(runJournal && input.runJournalEtag
        ? [
            {
              kind: 'replace' as const,
              record: runJournal,
              expectedEtag: input.runJournalEtag,
            },
          ]
        : []),
      ...(runJournalEntry
        ? [
            {
              kind: 'create' as const,
              record: runJournalEntry,
            },
          ]
        : []),
    ];
    const results = await this.store.batch(approval.agentId, operations);

    return {
      workingContext: results[0] as StoredRecord<WorkingContext>,
      task: results[1] as StoredRecord<Task>,
      approval: results[2] as StoredRecord<Approval>,
      runJournal: runJournal && input.runJournalEtag ? (results[3] as StoredRecord<RunJournal>) : null,
      runJournalEntry: runJournalEntry
        ? (results[runJournal && input.runJournalEtag ? 4 : 3] as StoredRecord<RunJournalEntry>)
        : null,
    };
  }
}

import {
  idempotencyRecordSchema,
  runJournalEntrySchema,
  runJournalSchema,
  taskEnvelopeSchema,
  taskSchema,
  type AgentId,
  type IdempotencyRecord,
  type RunJournal,
  type RunJournalEntry,
  type Task,
  type TaskEnvelope,
  type TaskEnvelopeId,
  type TaskId,
  type WorkingContext,
  workingContextSchema,
} from '@echidna-claw/contracts';

import { type StoredRecord } from '../documents/envelope.js';
import {
  OPEN_TASK_STATES,
  assertSameAgent,
  eq,
  inList,
  lte,
  operationalContainerName,
} from './common.js';
import { type BatchOperation, type PersistedRecordStore } from './store.js';

export interface TaskQueueGraphResult {
  idempotencyRecord?: StoredRecord<IdempotencyRecord>;
  runJournal: StoredRecord<RunJournal>;
  runJournalEntry: StoredRecord<RunJournalEntry>;
  task: StoredRecord<Task>;
  taskEnvelope?: StoredRecord<TaskEnvelope>;
  workingContext: StoredRecord<WorkingContext>;
}

export interface DeferredTaskGraphResult {
  idempotencyRecord?: StoredRecord<IdempotencyRecord>;
  task: StoredRecord<Task>;
  workingContext: StoredRecord<WorkingContext>;
}

export interface TaskLaunchRequestResult {
  idempotencyRecord: StoredRecord<IdempotencyRecord>;
  task: StoredRecord<Task>;
  taskEnvelope: StoredRecord<TaskEnvelope>;
}

export interface TaskRepository {
  createTask(task: Task): Promise<StoredRecord<Task>>;
  getTask(agentId: AgentId, taskId: TaskId): Promise<StoredRecord<Task> | null>;
  replaceTask(task: Task, expectedEtag: string): Promise<StoredRecord<Task>>;
  listOpenTasks(agentId: AgentId): Promise<StoredRecord<Task>[]>;
  listDeferredTasks(agentId: AgentId, limit?: number): Promise<StoredRecord<Task>[]>;
  listDueDeferredTasks(asOf: string, limit?: number): Promise<StoredRecord<Task>[]>;
  listQueuedTasks(agentId: AgentId, limit?: number): Promise<StoredRecord<Task>[]>;
  listQueuedTasksForDispatch(
    agentId: AgentId,
    asOf: string,
    limit?: number,
  ): Promise<StoredRecord<Task>[]>;
  listMergeCandidates(agentId: AgentId, mergeKey: string, limit?: number): Promise<StoredRecord<Task>[]>;
  createTaskEnvelope(taskEnvelope: TaskEnvelope): Promise<StoredRecord<TaskEnvelope>>;
  getTaskEnvelope(agentId: AgentId, taskEnvelopeId: TaskEnvelopeId): Promise<StoredRecord<TaskEnvelope> | null>;
  replaceTaskEnvelope(
    taskEnvelope: TaskEnvelope,
    expectedEtag: string,
  ): Promise<StoredRecord<TaskEnvelope>>;
  listTaskEnvelopesForTask(agentId: AgentId, taskId: TaskId): Promise<StoredRecord<TaskEnvelope>[]>;
  createTaskWithEnvelope(input: {
    idempotencyRecord?: IdempotencyRecord;
    runJournal: RunJournal;
    runJournalEntry: RunJournalEntry;
    task: Task;
    taskEnvelope: TaskEnvelope;
    workingContext: WorkingContext;
    workingContextEtag: string;
  }): Promise<TaskQueueGraphResult>;
  createDeferredTask(input: {
    idempotencyRecord?: IdempotencyRecord;
    task: Task;
    workingContext: WorkingContext;
    workingContextEtag: string;
  }): Promise<DeferredTaskGraphResult>;
  mergeDeferredTask(input: {
    idempotencyRecord?: IdempotencyRecord;
    task: Task;
    taskEtag: string;
    workingContext: WorkingContext;
    workingContextEtag: string;
  }): Promise<DeferredTaskGraphResult>;
  mergeTaskIntoQueue(input: {
    idempotencyRecord?: IdempotencyRecord;
    runJournal: RunJournal;
    runJournalEtag?: string;
    runJournalEntry: RunJournalEntry;
    task: Task;
    taskEtag: string;
    taskEnvelope?: TaskEnvelope;
    workingContext: WorkingContext;
    workingContextEtag: string;
  }): Promise<TaskQueueGraphResult>;
  activateDeferredTask(input: {
    idempotencyRecord?: IdempotencyRecord;
    runJournal: RunJournal;
    runJournalEntry: RunJournalEntry;
    task: Task;
    taskEtag: string;
    taskEnvelope: TaskEnvelope;
    workingContext: WorkingContext;
    workingContextEtag: string;
  }): Promise<TaskQueueGraphResult>;
  completeDeferredTask(input: {
    task: Task;
    taskEtag: string;
    workingContext: WorkingContext;
    workingContextEtag: string;
  }): Promise<DeferredTaskGraphResult>;
  recordTaskLaunchRequest(input: {
    idempotencyRecord: IdempotencyRecord;
    task: Task;
    taskEtag: string;
    taskEnvelope: TaskEnvelope;
    taskEnvelopeEtag: string;
  }): Promise<TaskLaunchRequestResult>;
  completeTaskLaunchRequest(input: {
    idempotencyRecord: IdempotencyRecord;
    idempotencyRecordEtag: string;
    task: Task;
    taskEtag: string;
    taskEnvelope: TaskEnvelope;
    taskEnvelopeEtag: string;
  }): Promise<TaskLaunchRequestResult>;
}

export class DefaultTaskRepository implements TaskRepository {
  constructor(private readonly store: PersistedRecordStore) {}

  async createTask(task: Task): Promise<StoredRecord<Task>> {
    return this.store.create(taskSchema.parse(task));
  }

  async getTask(agentId: AgentId, taskId: TaskId): Promise<StoredRecord<Task> | null> {
    return this.store.get(taskId, agentId, taskSchema);
  }

  async replaceTask(task: Task, expectedEtag: string): Promise<StoredRecord<Task>> {
    return this.store.replace(taskSchema.parse(task), expectedEtag);
  }

  async listOpenTasks(agentId: AgentId): Promise<StoredRecord<Task>[]> {
    return this.store.query({
      containerName: operationalContainerName,
      partitionKey: agentId,
      schema: taskSchema,
      where: [eq('recordType', 'task'), inList('state', [...OPEN_TASK_STATES])],
      orderBy: [
        { field: 'query.queueLaneRank', direction: 'asc' },
        { field: 'query.queuePriorityRank', direction: 'asc' },
        { field: 'query.dueAtSortValue', direction: 'asc' },
        { field: 'createdAt', direction: 'asc' },
      ],
    });
  }

  async listDeferredTasks(agentId: AgentId, limit = 50): Promise<StoredRecord<Task>[]> {
    return this.store.query({
      containerName: operationalContainerName,
      partitionKey: agentId,
      schema: taskSchema,
      where: [eq('recordType', 'task'), eq('state', 'deferred')],
      orderBy: [
        { field: 'query.queueLaneRank', direction: 'asc' },
        { field: 'query.queuePriorityRank', direction: 'asc' },
        { field: 'query.dueAtSortValue', direction: 'asc' },
        { field: 'createdAt', direction: 'asc' },
      ],
      limit,
    });
  }

  async listDueDeferredTasks(asOf: string, limit = 100): Promise<StoredRecord<Task>[]> {
    return this.store.query({
      containerName: operationalContainerName,
      schema: taskSchema,
      where: [eq('recordType', 'task'), eq('state', 'deferred'), lte('dueAt', asOf)],
      orderBy: [
        { field: 'query.queueLaneRank', direction: 'asc' },
        { field: 'query.queuePriorityRank', direction: 'asc' },
        { field: 'query.dueAtSortValue', direction: 'asc' },
        { field: 'createdAt', direction: 'asc' },
      ],
      limit,
    });
  }

  async listQueuedTasks(agentId: AgentId, limit = 50): Promise<StoredRecord<Task>[]> {
    return this.store.query({
      containerName: operationalContainerName,
      partitionKey: agentId,
      schema: taskSchema,
      where: [eq('recordType', 'task'), eq('state', 'queued')],
      orderBy: [
        { field: 'query.queueLaneRank', direction: 'asc' },
        { field: 'query.queuePriorityRank', direction: 'asc' },
        { field: 'query.dueAtSortValue', direction: 'asc' },
        { field: 'createdAt', direction: 'asc' },
      ],
      limit,
    });
  }

  async listQueuedTasksForDispatch(
    agentId: AgentId,
    asOf: string,
    limit = 50,
  ): Promise<StoredRecord<Task>[]> {
    const queued = await this.store.query({
      containerName: operationalContainerName,
      partitionKey: agentId,
      schema: taskSchema,
      where: [eq('recordType', 'task'), eq('state', 'queued')],
      orderBy: [
        { field: 'query.queueLaneRank', direction: 'asc' },
        { field: 'query.queuePriorityRank', direction: 'asc' },
        { field: 'query.launchRequestedRank', direction: 'asc' },
        { field: 'query.dueAtSortValue', direction: 'asc' },
        { field: 'createdAt', direction: 'asc' },
      ],
    });

    return queued
      .filter((task) => task.value.dueAt == null || task.value.dueAt <= asOf)
      .slice(0, limit);
  }

  async listMergeCandidates(
    agentId: AgentId,
    mergeKey: string,
    limit = 10,
  ): Promise<StoredRecord<Task>[]> {
    return this.store.query({
      containerName: operationalContainerName,
      partitionKey: agentId,
      schema: taskSchema,
      where: [
        eq('recordType', 'task'),
        eq('mergeKey', mergeKey),
        inList('state', ['queued', 'deferred']),
      ],
      orderBy: [
        { field: 'query.queueLaneRank', direction: 'asc' },
        { field: 'query.queuePriorityRank', direction: 'asc' },
        { field: 'query.dueAtSortValue', direction: 'asc' },
        { field: 'createdAt', direction: 'asc' },
      ],
      limit,
    });
  }

  async createTaskEnvelope(taskEnvelope: TaskEnvelope): Promise<StoredRecord<TaskEnvelope>> {
    return this.store.create(taskEnvelopeSchema.parse(taskEnvelope));
  }

  async getTaskEnvelope(
    agentId: AgentId,
    taskEnvelopeId: TaskEnvelopeId,
  ): Promise<StoredRecord<TaskEnvelope> | null> {
    return this.store.get(taskEnvelopeId, agentId, taskEnvelopeSchema);
  }

  async replaceTaskEnvelope(
    taskEnvelope: TaskEnvelope,
    expectedEtag: string,
  ): Promise<StoredRecord<TaskEnvelope>> {
    return this.store.replace(taskEnvelopeSchema.parse(taskEnvelope), expectedEtag);
  }

  async listTaskEnvelopesForTask(
    agentId: AgentId,
    taskId: TaskId,
  ): Promise<StoredRecord<TaskEnvelope>[]> {
    return this.store.query({
      containerName: operationalContainerName,
      partitionKey: agentId,
      schema: taskEnvelopeSchema,
      where: [eq('recordType', 'task_envelope'), eq('taskId', taskId)],
      orderBy: [{ field: 'createdAt', direction: 'asc' }],
    });
  }

  async createTaskWithEnvelope(input: {
    idempotencyRecord?: IdempotencyRecord;
    runJournal: RunJournal;
    runJournalEntry: RunJournalEntry;
    task: Task;
    taskEnvelope: TaskEnvelope;
    workingContext: WorkingContext;
    workingContextEtag: string;
  }): Promise<TaskQueueGraphResult> {
    const task = taskSchema.parse(input.task);
    const taskEnvelope = taskEnvelopeSchema.parse(input.taskEnvelope);
    const runJournal = runJournalSchema.parse(input.runJournal);
    const runJournalEntry = runJournalEntrySchema.parse(input.runJournalEntry);
    const workingContext = workingContextSchema.parse(input.workingContext);
    const idempotencyRecord = input.idempotencyRecord
      ? idempotencyRecordSchema.parse(input.idempotencyRecord)
      : undefined;
    assertSameAgent(task.agentId, [
      task,
      taskEnvelope,
      runJournal,
      runJournalEntry,
      workingContext,
      ...(idempotencyRecord ? [idempotencyRecord] : []),
    ]);

    const operations: BatchOperation[] = [
      {
        kind: 'replace' as const,
        record: workingContext,
        expectedEtag: input.workingContextEtag,
      },
      {
        kind: 'create' as const,
        record: task,
      },
      {
        kind: 'create' as const,
        record: taskEnvelope,
      },
      {
        kind: 'create' as const,
        record: runJournal,
      },
      {
        kind: 'create' as const,
        record: runJournalEntry,
      },
      ...(idempotencyRecord
        ? [
            {
              kind: 'create' as const,
              record: idempotencyRecord,
            },
          ]
        : []),
    ];
    const results = await this.store.batch(task.agentId, operations);
    const idempotencyOffset = idempotencyRecord ? 5 : -1;

    return {
      workingContext: results[0] as StoredRecord<WorkingContext>,
      task: results[1] as StoredRecord<Task>,
      taskEnvelope: results[2] as StoredRecord<TaskEnvelope>,
      runJournal: results[3] as StoredRecord<RunJournal>,
      runJournalEntry: results[4] as StoredRecord<RunJournalEntry>,
      ...(idempotencyRecord
        ? {
            idempotencyRecord: results[idempotencyOffset] as StoredRecord<IdempotencyRecord>,
          }
        : {}),
    };
  }

  async createDeferredTask(input: {
    idempotencyRecord?: IdempotencyRecord;
    task: Task;
    workingContext: WorkingContext;
    workingContextEtag: string;
  }): Promise<DeferredTaskGraphResult> {
    const task = taskSchema.parse(input.task);
    const workingContext = workingContextSchema.parse(input.workingContext);
    const idempotencyRecord = input.idempotencyRecord
      ? idempotencyRecordSchema.parse(input.idempotencyRecord)
      : undefined;
    assertSameAgent(task.agentId, [
      task,
      workingContext,
      ...(idempotencyRecord ? [idempotencyRecord] : []),
    ]);

    const operations: BatchOperation[] = [
      {
        kind: 'replace' as const,
        record: workingContext,
        expectedEtag: input.workingContextEtag,
      },
      {
        kind: 'create' as const,
        record: task,
      },
      ...(idempotencyRecord
        ? [
            {
              kind: 'create' as const,
              record: idempotencyRecord,
            },
          ]
        : []),
    ];
    const results = await this.store.batch(task.agentId, operations);

    return {
      workingContext: results[0] as StoredRecord<WorkingContext>,
      task: results[1] as StoredRecord<Task>,
      ...(idempotencyRecord
        ? {
            idempotencyRecord: results[2] as StoredRecord<IdempotencyRecord>,
          }
        : {}),
    };
  }

  async mergeDeferredTask(input: {
    idempotencyRecord?: IdempotencyRecord;
    task: Task;
    taskEtag: string;
    workingContext: WorkingContext;
    workingContextEtag: string;
  }): Promise<DeferredTaskGraphResult> {
    const task = taskSchema.parse(input.task);
    const workingContext = workingContextSchema.parse(input.workingContext);
    const idempotencyRecord = input.idempotencyRecord
      ? idempotencyRecordSchema.parse(input.idempotencyRecord)
      : undefined;
    assertSameAgent(task.agentId, [
      task,
      workingContext,
      ...(idempotencyRecord ? [idempotencyRecord] : []),
    ]);

    const operations: BatchOperation[] = [
      {
        kind: 'replace' as const,
        record: workingContext,
        expectedEtag: input.workingContextEtag,
      },
      {
        kind: 'replace' as const,
        record: task,
        expectedEtag: input.taskEtag,
      },
      ...(idempotencyRecord
        ? [
            {
              kind: 'create' as const,
              record: idempotencyRecord,
            },
          ]
        : []),
    ];
    const results = await this.store.batch(task.agentId, operations);

    return {
      workingContext: results[0] as StoredRecord<WorkingContext>,
      task: results[1] as StoredRecord<Task>,
      ...(idempotencyRecord
        ? {
            idempotencyRecord: results[2] as StoredRecord<IdempotencyRecord>,
          }
        : {}),
    };
  }

  async mergeTaskIntoQueue(input: {
    idempotencyRecord?: IdempotencyRecord;
    runJournal: RunJournal;
    runJournalEtag?: string;
    runJournalEntry: RunJournalEntry;
    task: Task;
    taskEtag: string;
    taskEnvelope?: TaskEnvelope;
    workingContext: WorkingContext;
    workingContextEtag: string;
  }): Promise<TaskQueueGraphResult> {
    const task = taskSchema.parse(input.task);
    const runJournal = runJournalSchema.parse(input.runJournal);
    const runJournalEntry = runJournalEntrySchema.parse(input.runJournalEntry);
    const workingContext = workingContextSchema.parse(input.workingContext);
    const taskEnvelope = input.taskEnvelope ? taskEnvelopeSchema.parse(input.taskEnvelope) : undefined;
    const idempotencyRecord = input.idempotencyRecord
      ? idempotencyRecordSchema.parse(input.idempotencyRecord)
      : undefined;
    assertSameAgent(task.agentId, [
      task,
      runJournal,
      runJournalEntry,
      workingContext,
      ...(taskEnvelope ? [taskEnvelope] : []),
      ...(idempotencyRecord ? [idempotencyRecord] : []),
    ]);

    const operations: BatchOperation[] = [
      {
        kind: 'replace' as const,
        record: workingContext,
        expectedEtag: input.workingContextEtag,
      },
      {
        kind: 'replace' as const,
        record: task,
        expectedEtag: input.taskEtag,
      },
      {
        ...(input.runJournalEtag
          ? {
              kind: 'replace' as const,
              record: runJournal,
              expectedEtag: input.runJournalEtag,
            }
          : {
              kind: 'create' as const,
              record: runJournal,
            }),
      },
      {
        kind: 'create' as const,
        record: runJournalEntry,
      },
      ...(taskEnvelope
        ? [
            {
              kind: 'create' as const,
              record: taskEnvelope,
            },
          ]
        : []),
      ...(idempotencyRecord
        ? [
            {
              kind: 'create' as const,
              record: idempotencyRecord,
            },
          ]
        : []),
    ];
    const results = await this.store.batch(task.agentId, operations);

    const taskEnvelopeIndex = taskEnvelope ? 4 : -1;
    const idempotencyIndex = taskEnvelope ? 5 : 4;

    return {
      workingContext: results[0] as StoredRecord<WorkingContext>,
      task: results[1] as StoredRecord<Task>,
      runJournal: results[2] as StoredRecord<RunJournal>,
      runJournalEntry: results[3] as StoredRecord<RunJournalEntry>,
      ...(taskEnvelope != null
        ? {
            taskEnvelope: results[taskEnvelopeIndex] as StoredRecord<TaskEnvelope>,
          }
        : {}),
      ...(idempotencyRecord
        ? {
            idempotencyRecord: results[idempotencyIndex] as StoredRecord<IdempotencyRecord>,
          }
        : {}),
    };
  }

  async activateDeferredTask(input: {
    idempotencyRecord?: IdempotencyRecord;
    runJournal: RunJournal;
    runJournalEntry: RunJournalEntry;
    task: Task;
    taskEtag: string;
    taskEnvelope: TaskEnvelope;
    workingContext: WorkingContext;
    workingContextEtag: string;
  }): Promise<TaskQueueGraphResult> {
    const task = taskSchema.parse(input.task);
    const taskEnvelope = taskEnvelopeSchema.parse(input.taskEnvelope);
    const runJournal = runJournalSchema.parse(input.runJournal);
    const runJournalEntry = runJournalEntrySchema.parse(input.runJournalEntry);
    const workingContext = workingContextSchema.parse(input.workingContext);
    const idempotencyRecord = input.idempotencyRecord
      ? idempotencyRecordSchema.parse(input.idempotencyRecord)
      : undefined;
    assertSameAgent(task.agentId, [
      task,
      taskEnvelope,
      runJournal,
      runJournalEntry,
      workingContext,
      ...(idempotencyRecord ? [idempotencyRecord] : []),
    ]);

    const operations: BatchOperation[] = [
      {
        kind: 'replace' as const,
        record: workingContext,
        expectedEtag: input.workingContextEtag,
      },
      {
        kind: 'replace' as const,
        record: task,
        expectedEtag: input.taskEtag,
      },
      {
        kind: 'create' as const,
        record: taskEnvelope,
      },
      {
        kind: 'create' as const,
        record: runJournal,
      },
      {
        kind: 'create' as const,
        record: runJournalEntry,
      },
      ...(idempotencyRecord
        ? [
            {
              kind: 'create' as const,
              record: idempotencyRecord,
            },
          ]
        : []),
    ];
    const results = await this.store.batch(task.agentId, operations);

    return {
      workingContext: results[0] as StoredRecord<WorkingContext>,
      task: results[1] as StoredRecord<Task>,
      taskEnvelope: results[2] as StoredRecord<TaskEnvelope>,
      runJournal: results[3] as StoredRecord<RunJournal>,
      runJournalEntry: results[4] as StoredRecord<RunJournalEntry>,
      ...(idempotencyRecord
        ? {
            idempotencyRecord: results[5] as StoredRecord<IdempotencyRecord>,
          }
        : {}),
    };
  }

  async completeDeferredTask(input: {
    task: Task;
    taskEtag: string;
    workingContext: WorkingContext;
    workingContextEtag: string;
  }): Promise<DeferredTaskGraphResult> {
    const task = taskSchema.parse(input.task);
    const workingContext = workingContextSchema.parse(input.workingContext);
    assertSameAgent(task.agentId, [task, workingContext]);

    const [storedWorkingContext, storedTask] = await this.store.batch(task.agentId, [
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
    ]);

    return {
      workingContext: storedWorkingContext as StoredRecord<WorkingContext>,
      task: storedTask as StoredRecord<Task>,
    };
  }

  async recordTaskLaunchRequest(input: {
    idempotencyRecord: IdempotencyRecord;
    task: Task;
    taskEtag: string;
    taskEnvelope: TaskEnvelope;
    taskEnvelopeEtag: string;
  }): Promise<TaskLaunchRequestResult> {
    const task = taskSchema.parse(input.task);
    const taskEnvelope = taskEnvelopeSchema.parse(input.taskEnvelope);
    const idempotencyRecord = idempotencyRecordSchema.parse(input.idempotencyRecord);
    assertSameAgent(task.agentId, [task, taskEnvelope, idempotencyRecord]);

    const [storedTask, storedTaskEnvelope, storedIdempotencyRecord] = await this.store.batch(
      task.agentId,
      [
        {
          kind: 'replace',
          record: task,
          expectedEtag: input.taskEtag,
        },
        {
          kind: 'replace',
          record: taskEnvelope,
          expectedEtag: input.taskEnvelopeEtag,
        },
        {
          kind: 'create',
          record: idempotencyRecord,
        },
      ],
    );

    return {
      task: storedTask as StoredRecord<Task>,
      taskEnvelope: storedTaskEnvelope as StoredRecord<TaskEnvelope>,
      idempotencyRecord: storedIdempotencyRecord as StoredRecord<IdempotencyRecord>,
    };
  }

  async completeTaskLaunchRequest(input: {
    idempotencyRecord: IdempotencyRecord;
    idempotencyRecordEtag: string;
    task: Task;
    taskEtag: string;
    taskEnvelope: TaskEnvelope;
    taskEnvelopeEtag: string;
  }): Promise<TaskLaunchRequestResult> {
    const task = taskSchema.parse(input.task);
    const taskEnvelope = taskEnvelopeSchema.parse(input.taskEnvelope);
    const idempotencyRecord = idempotencyRecordSchema.parse(input.idempotencyRecord);
    assertSameAgent(task.agentId, [task, taskEnvelope, idempotencyRecord]);

    const [storedTask, storedTaskEnvelope, storedIdempotencyRecord] = await this.store.batch(
      task.agentId,
      [
        {
          kind: 'replace',
          record: task,
          expectedEtag: input.taskEtag,
        },
        {
          kind: 'replace',
          record: taskEnvelope,
          expectedEtag: input.taskEnvelopeEtag,
        },
        {
          kind: 'replace',
          record: idempotencyRecord,
          expectedEtag: input.idempotencyRecordEtag,
        },
      ],
    );

    return {
      task: storedTask as StoredRecord<Task>,
      taskEnvelope: storedTaskEnvelope as StoredRecord<TaskEnvelope>,
      idempotencyRecord: storedIdempotencyRecord as StoredRecord<IdempotencyRecord>,
    };
  }
}

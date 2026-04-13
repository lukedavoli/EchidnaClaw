import {
  taskEnvelopeSchema,
  taskSchema,
  type AgentId,
  type Task,
  type TaskEnvelope,
  type TaskEnvelopeId,
  type TaskId,
} from '@echidna-claw/contracts';

import { type StoredRecord } from '../documents/envelope.js';
import { OPEN_TASK_STATES, eq, inList, operationalContainerName } from './common.js';
import { type PersistedRecordStore } from './store.js';

export interface TaskRepository {
  createTask(task: Task): Promise<StoredRecord<Task>>;
  getTask(agentId: AgentId, taskId: TaskId): Promise<StoredRecord<Task> | null>;
  replaceTask(task: Task, expectedEtag: string): Promise<StoredRecord<Task>>;
  listOpenTasks(agentId: AgentId): Promise<StoredRecord<Task>[]>;
  listQueuedTasks(agentId: AgentId, limit?: number): Promise<StoredRecord<Task>[]>;
  createTaskEnvelope(taskEnvelope: TaskEnvelope): Promise<StoredRecord<TaskEnvelope>>;
  getTaskEnvelope(agentId: AgentId, taskEnvelopeId: TaskEnvelopeId): Promise<StoredRecord<TaskEnvelope> | null>;
  replaceTaskEnvelope(
    taskEnvelope: TaskEnvelope,
    expectedEtag: string,
  ): Promise<StoredRecord<TaskEnvelope>>;
  listTaskEnvelopesForTask(agentId: AgentId, taskId: TaskId): Promise<StoredRecord<TaskEnvelope>[]>;
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
        { field: 'query.queuePriorityRank', direction: 'asc' },
        { field: 'dueAt', direction: 'asc' },
        { field: 'createdAt', direction: 'asc' },
      ],
    });
  }

  async listQueuedTasks(agentId: AgentId, limit = 50): Promise<StoredRecord<Task>[]> {
    return this.store.query({
      containerName: operationalContainerName,
      partitionKey: agentId,
      schema: taskSchema,
      where: [eq('recordType', 'task'), eq('state', 'queued')],
      orderBy: [
        { field: 'query.queuePriorityRank', direction: 'asc' },
        { field: 'dueAt', direction: 'asc' },
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
}

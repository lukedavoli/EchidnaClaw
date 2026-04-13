import {
  idempotencyRecordSchema,
  scheduleSchema,
  taskEnvelopeSchema,
  taskSchema,
  type AgentId,
  type IdempotencyRecord,
  type Schedule,
  type ScheduleId,
  type Task,
  type TaskEnvelope,
} from '@echidna-claw/contracts';

import { type StoredRecord } from '../documents/envelope.js';
import { assertSameAgent, eq, lte, operationalContainerName } from './common.js';
import { type PersistedRecordStore } from './store.js';

export interface ScheduleMaterializationResult {
  idempotencyRecord: StoredRecord<IdempotencyRecord>;
  schedule: StoredRecord<Schedule>;
  task: StoredRecord<Task>;
  taskEnvelope: StoredRecord<TaskEnvelope>;
}

export interface ScheduleRepository {
  create(schedule: Schedule): Promise<StoredRecord<Schedule>>;
  get(agentId: AgentId, scheduleId: ScheduleId): Promise<StoredRecord<Schedule> | null>;
  replace(schedule: Schedule, expectedEtag: string): Promise<StoredRecord<Schedule>>;
  listDueSchedules(asOf: string, limit?: number): Promise<StoredRecord<Schedule>[]>;
  materializeDueSchedule(input: {
    idempotencyRecord: IdempotencyRecord;
    schedule: Schedule;
    scheduleEtag: string;
    task: Task;
    taskEnvelope: TaskEnvelope;
  }): Promise<ScheduleMaterializationResult>;
}

export class DefaultScheduleRepository implements ScheduleRepository {
  constructor(private readonly store: PersistedRecordStore) {}

  async create(schedule: Schedule): Promise<StoredRecord<Schedule>> {
    return this.store.create(scheduleSchema.parse(schedule));
  }

  async get(agentId: AgentId, scheduleId: ScheduleId): Promise<StoredRecord<Schedule> | null> {
    return this.store.get(scheduleId, agentId, scheduleSchema);
  }

  async replace(schedule: Schedule, expectedEtag: string): Promise<StoredRecord<Schedule>> {
    return this.store.replace(scheduleSchema.parse(schedule), expectedEtag);
  }

  async listDueSchedules(asOf: string, limit = 100): Promise<StoredRecord<Schedule>[]> {
    return this.store.query({
      containerName: operationalContainerName,
      schema: scheduleSchema,
      where: [
        eq('recordType', 'schedule'),
        eq('state', 'active'),
        lte('nextDueAt', asOf),
      ],
      orderBy: [{ field: 'nextDueAt', direction: 'asc' }],
      limit,
    });
  }

  async materializeDueSchedule(input: {
    idempotencyRecord: IdempotencyRecord;
    schedule: Schedule;
    scheduleEtag: string;
    task: Task;
    taskEnvelope: TaskEnvelope;
  }): Promise<ScheduleMaterializationResult> {
    const schedule = scheduleSchema.parse(input.schedule);
    const task = taskSchema.parse(input.task);
    const taskEnvelope = taskEnvelopeSchema.parse(input.taskEnvelope);
    const idempotencyRecord = idempotencyRecordSchema.parse(input.idempotencyRecord);
    assertSameAgent(schedule.agentId, [schedule, task, taskEnvelope, idempotencyRecord]);

    const [storedSchedule, storedTask, storedTaskEnvelope, storedIdempotencyRecord] =
      await this.store.batch(schedule.agentId, [
        {
          kind: 'replace',
          record: schedule,
          expectedEtag: input.scheduleEtag,
        },
        {
          kind: 'create',
          record: task,
        },
        {
          kind: 'create',
          record: taskEnvelope,
        },
        {
          kind: 'create',
          record: idempotencyRecord,
        },
      ]);

    return {
      schedule: storedSchedule as StoredRecord<Schedule>,
      task: storedTask as StoredRecord<Task>,
      taskEnvelope: storedTaskEnvelope as StoredRecord<TaskEnvelope>,
      idempotencyRecord: storedIdempotencyRecord as StoredRecord<IdempotencyRecord>,
    };
  }
}

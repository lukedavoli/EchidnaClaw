import {
  idempotencyRecordSchema,
  scheduleSchema,
  taskSchema,
  type AgentId,
  type IdempotencyRecord,
  type Schedule,
  type ScheduleId,
  type ScheduleState,
  type Task,
} from '@echidna-claw/contracts';

import { type StoredRecord } from '../documents/envelope.js';
import { assertSameAgent, eq, inList, lte, operationalContainerName } from './common.js';
import { type PersistedRecordStore } from './store.js';

export interface ScheduleOccurrenceMaterializationResult {
  idempotencyRecord: StoredRecord<IdempotencyRecord>;
  schedule: StoredRecord<Schedule>;
  task: StoredRecord<Task>;
}

export interface ScheduleRepository {
  create(schedule: Schedule): Promise<StoredRecord<Schedule>>;
  get(agentId: AgentId, scheduleId: ScheduleId): Promise<StoredRecord<Schedule> | null>;
  replace(schedule: Schedule, expectedEtag: string): Promise<StoredRecord<Schedule>>;
  listByAgent(agentId: AgentId, states?: readonly ScheduleState[]): Promise<StoredRecord<Schedule>[]>;
  listDueSchedules(asOf: string, limit?: number): Promise<StoredRecord<Schedule>[]>;
  materializeDueOccurrenceTask(input: {
    idempotencyRecord: IdempotencyRecord;
    schedule: Schedule;
    scheduleEtag: string;
    task: Task;
  }): Promise<ScheduleOccurrenceMaterializationResult>;
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

  async listByAgent(
    agentId: AgentId,
    states?: readonly ScheduleState[],
  ): Promise<StoredRecord<Schedule>[]> {
    return this.store.query({
      containerName: operationalContainerName,
      partitionKey: agentId,
      schema: scheduleSchema,
      where: [
        eq('recordType', 'schedule'),
        ...(states && states.length > 0 ? [inList('state', states)] : []),
      ],
      orderBy: [{ field: 'nextDueAt', direction: 'asc' }],
    });
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

  async materializeDueOccurrenceTask(input: {
    idempotencyRecord: IdempotencyRecord;
    schedule: Schedule;
    scheduleEtag: string;
    task: Task;
  }): Promise<ScheduleOccurrenceMaterializationResult> {
    const schedule = scheduleSchema.parse(input.schedule);
    const task = taskSchema.parse(input.task);
    const idempotencyRecord = idempotencyRecordSchema.parse(input.idempotencyRecord);
    assertSameAgent(schedule.agentId, [schedule, task, idempotencyRecord]);

    const [storedSchedule, storedTask, storedIdempotencyRecord] = await this.store.batch(
      schedule.agentId,
      [
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
          record: idempotencyRecord,
        },
      ],
    );

    return {
      schedule: storedSchedule as StoredRecord<Schedule>,
      task: storedTask as StoredRecord<Task>,
      idempotencyRecord: storedIdempotencyRecord as StoredRecord<IdempotencyRecord>,
    };
  }
}

import { randomBytes } from 'node:crypto';

import type {
  CorrelationMetadata,
  NormalizedRecurrence,
  Schedule,
} from '@echidna-claw/contracts';
import { calculateNextDueAt } from '@echidna-claw/domain';

import type { RepositoryBundle } from '../../adapters/repositories/index.js';
import { ConflictError, NotFoundError } from '../../http/errors.js';

type ChangeScheduleAction = 'create' | 'delete' | 'pause' | 'resume' | 'update';
type ChangeScheduleWeekday =
  | 'friday'
  | 'monday'
  | 'saturday'
  | 'sunday'
  | 'thursday'
  | 'tuesday'
  | 'wednesday';
type ChangeScheduleRecurrenceInput = {
  anchorAt?: string;
  frequency?: 'hourly' | 'daily' | 'weekly';
  interval?: number;
  localTime?: string;
  timeZone?: string;
  weekdays?: ChangeScheduleWeekday[];
};

export interface ScheduleMutationService {
  mutate(input: {
    action: ChangeScheduleAction;
    agentId: string;
    correlation: CorrelationMetadata;
    description?: string;
    naturalLanguageRequest?: string;
    recurrence?: ChangeScheduleRecurrenceInput;
    scheduleId?: string;
    skipMissedOccurrencesOnRestore?: boolean;
  }): Promise<{
    nextDueAt: string | null;
    outputText: string;
    schedule: Schedule;
  }>;
}

function now(): string {
  return new Date().toISOString();
}

function createScheduleIdentifier(): string {
  return `sch_${randomBytes(12).toString('hex')}`;
}

function formatNextDueAt(nextDueAt: string | null): string {
  return nextDueAt ?? 'none';
}

function deriveLocalTime(anchorAt: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    timeZone,
  }).formatToParts(new Date(anchorAt));
  const hour = parts.find((part) => part.type === 'hour')?.value;
  const minute = parts.find((part) => part.type === 'minute')?.value;

  if (!hour || !minute) {
    throw new Error(`Unable to derive a local time for '${timeZone}'.`);
  }

  return `${hour}:${minute}`;
}

function deriveAnchorWeekday(
  anchorAt: string,
  timeZone: string,
): ChangeScheduleWeekday {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
  })
    .format(new Date(anchorAt))
    .toLowerCase();

  switch (weekday) {
    case 'monday':
    case 'tuesday':
    case 'wednesday':
    case 'thursday':
    case 'friday':
    case 'saturday':
    case 'sunday':
      return weekday;
    default:
      throw new Error(`Unable to derive a weekday for '${timeZone}'.`);
  }
}

function normalizeRecurrence(input: {
  agentTimeZone: string;
  nowAt: string;
  recurrence?: ChangeScheduleRecurrenceInput;
  existing?: NormalizedRecurrence;
}): NormalizedRecurrence {
  const frequency = input.recurrence?.frequency ?? input.existing?.frequency;
  if (!frequency) {
    throw new ConflictError('A recurrence frequency is required.');
  }

  const interval = input.recurrence?.interval ?? input.existing?.interval ?? 1;
  const timeZone =
    input.recurrence?.timeZone ?? input.existing?.timeZone ?? input.agentTimeZone;
  const anchorAt = input.recurrence?.anchorAt ?? input.existing?.anchorAt ?? input.nowAt;
  const base: NormalizedRecurrence = {
    frequency,
    interval,
    timeZone,
    anchorAt,
  };

  if (frequency === 'hourly') {
    return base;
  }

  const localTime =
    input.recurrence?.localTime ??
    input.existing?.localTime ??
    deriveLocalTime(anchorAt, timeZone);

  if (frequency === 'daily') {
    return {
      ...base,
      localTime,
    };
  }

  return {
    ...base,
    localTime,
    weekdays:
      input.recurrence?.weekdays ??
      input.existing?.weekdays ??
      [deriveAnchorWeekday(anchorAt, timeZone)],
  };
}

async function getRequiredSchedule(
  repositories: RepositoryBundle,
  agentId: string,
  scheduleId: string | undefined,
) {
  if (!scheduleId) {
    throw new ConflictError('A scheduleId is required for this schedule action.');
  }

  const storedSchedule = await repositories.schedules.get(agentId, scheduleId);
  if (!storedSchedule) {
    throw new NotFoundError('Schedule not found.');
  }

  return storedSchedule;
}

export function createScheduleMutationService(options: {
  repositories: RepositoryBundle;
}): ScheduleMutationService {
  return {
    async mutate(input) {
      const currentTime = now();
      const storedAgent = await options.repositories.agents.get(input.agentId);
      if (!storedAgent) {
        throw new NotFoundError('Agent not found.');
      }

      if (input.action === 'create') {
        if (!input.description || !input.naturalLanguageRequest) {
          throw new ConflictError('Create schedule requires description and naturalLanguageRequest.');
        }

        const recurrence = normalizeRecurrence({
          agentTimeZone: storedAgent.value.timeZone,
          nowAt: currentTime,
          ...(input.recurrence ? { recurrence: input.recurrence } : {}),
        });
        const draft: Schedule = {
          id: createScheduleIdentifier(),
          recordType: 'schedule',
          schemaVersion: 1,
          createdAt: currentTime,
          updatedAt: currentTime,
          correlation: input.correlation,
          agentId: input.agentId,
          state: 'active',
          description: input.description,
          naturalLanguageRequest: input.naturalLanguageRequest,
          recurrence,
          nextDueAt: null,
          lastMaterializedOccurrenceAt: null,
          skipMissedOccurrencesOnRestore: true,
        };
        const schedule = {
          ...draft,
          nextDueAt: calculateNextDueAt(draft, currentTime),
        };
        await options.repositories.schedules.create(schedule);

        return {
          nextDueAt: schedule.nextDueAt,
          outputText: `Created schedule ${schedule.id}. Next due at ${formatNextDueAt(schedule.nextDueAt)}.`,
          schedule,
        };
      }

      const storedSchedule = await getRequiredSchedule(
        options.repositories,
        input.agentId,
        input.scheduleId,
      );

      if (input.action === 'pause') {
        const schedule = {
          ...storedSchedule.value,
          state: 'paused' as const,
          nextDueAt: null,
          updatedAt: currentTime,
        };
        await options.repositories.schedules.replace(schedule, storedSchedule.etag);

        return {
          nextDueAt: schedule.nextDueAt,
          outputText: `Paused schedule ${schedule.id}.`,
          schedule,
        };
      }

      if (input.action === 'resume') {
        if (storedSchedule.value.state === 'soft_deleted') {
          throw new ConflictError('Soft-deleted schedules cannot be resumed.');
        }

        const schedule = {
          ...storedSchedule.value,
          state: 'active' as const,
          updatedAt: currentTime,
        };
        const resumedSchedule = {
          ...schedule,
          nextDueAt: calculateNextDueAt(schedule, currentTime),
        };
        await options.repositories.schedules.replace(resumedSchedule, storedSchedule.etag);

        return {
          nextDueAt: resumedSchedule.nextDueAt,
          outputText: `Resumed schedule ${resumedSchedule.id}. Next due at ${formatNextDueAt(resumedSchedule.nextDueAt)}.`,
          schedule: resumedSchedule,
        };
      }

      if (input.action === 'delete') {
        const schedule = {
          ...storedSchedule.value,
          state: 'soft_deleted' as const,
          nextDueAt: null,
          updatedAt: currentTime,
        };
        await options.repositories.schedules.replace(schedule, storedSchedule.etag);

        return {
          nextDueAt: schedule.nextDueAt,
          outputText: `Soft-deleted schedule ${schedule.id}.`,
          schedule,
        };
      }

      const recurrence = normalizeRecurrence({
        agentTimeZone: storedAgent.value.timeZone,
        nowAt: currentTime,
        ...(input.recurrence ? { recurrence: input.recurrence } : {}),
        existing: storedSchedule.value.recurrence,
      });
      const updatedSchedule: Schedule = {
        ...storedSchedule.value,
        updatedAt: currentTime,
        description: input.description ?? storedSchedule.value.description,
        naturalLanguageRequest:
          input.naturalLanguageRequest ?? storedSchedule.value.naturalLanguageRequest,
        recurrence,
        nextDueAt: null,
      };
      const finalizedSchedule = {
        ...updatedSchedule,
        nextDueAt:
          updatedSchedule.state === 'active'
            ? calculateNextDueAt(updatedSchedule, currentTime)
            : null,
      };
      await options.repositories.schedules.replace(finalizedSchedule, storedSchedule.etag);

      return {
        nextDueAt: finalizedSchedule.nextDueAt,
        outputText: `Updated schedule ${finalizedSchedule.id}. Next due at ${formatNextDueAt(finalizedSchedule.nextDueAt)}.`,
        schedule: finalizedSchedule,
      };
    },
  };
}

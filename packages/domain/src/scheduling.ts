import { type NormalizedRecurrence, type Schedule } from '@echidna-claw/contracts';

const millisecondsPerHour = 60 * 60 * 1000;
const millisecondsPerDay = 24 * millisecondsPerHour;

const weekdayToUtcDay: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function toDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO timestamp '${value}'`);
  }
  return parsed;
}

function addDuration(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}

function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function getNextHourlyOccurrence(recurrence: NormalizedRecurrence, after: Date): string {
  const anchor = toDate(recurrence.anchorAt);
  let candidate = anchor;

  while (candidate <= after) {
    candidate = addDuration(candidate, recurrence.interval * millisecondsPerHour);
  }

  return candidate.toISOString();
}

function getNextDailyOccurrence(recurrence: NormalizedRecurrence, after: Date): string {
  const anchor = toDate(recurrence.anchorAt);
  let candidate = anchor;

  while (candidate <= after) {
    candidate = addDuration(candidate, recurrence.interval * millisecondsPerDay);
  }

  return candidate.toISOString();
}

function getNextWeeklyOccurrence(recurrence: NormalizedRecurrence, after: Date): string {
  const anchor = toDate(recurrence.anchorAt);
  const weekdays = new Set((recurrence.weekdays ?? []).map((weekday) => weekdayToUtcDay[weekday]));
  let candidate = anchor;

  for (let iterations = 0; iterations < 366 * 5; iterations += 1) {
    if (candidate > after) {
      const candidateWeek = Math.floor(
        (startOfUtcDay(candidate) - startOfUtcDay(anchor)) / (7 * millisecondsPerDay),
      );
      const matchesInterval = candidateWeek >= 0 && candidateWeek % recurrence.interval === 0;
      const matchesWeekday = weekdays.size === 0 || weekdays.has(candidate.getUTCDay());

      if (matchesInterval && matchesWeekday) {
        return candidate.toISOString();
      }
    }

    candidate = addDuration(candidate, millisecondsPerDay);
  }

  throw new Error('Unable to calculate next weekly occurrence within search horizon');
}

export function getNextOccurrenceAt(recurrence: NormalizedRecurrence, afterAt: string): string {
  const after = toDate(afterAt);

  switch (recurrence.frequency) {
    case 'hourly':
      return getNextHourlyOccurrence(recurrence, after);
    case 'daily':
      return getNextDailyOccurrence(recurrence, after);
    case 'weekly':
      return getNextWeeklyOccurrence(recurrence, after);
    default:
      throw new Error(`Unsupported recurrence frequency '${String(recurrence.frequency)}'`);
  }
}

export function calculateNextDueAt(schedule: Schedule, afterAt: string): string | null {
  if (schedule.state !== 'active') {
    return null;
  }

  return getNextOccurrenceAt(schedule.recurrence, afterAt);
}

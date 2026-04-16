import { Temporal } from '@js-temporal/polyfill';

import { type NormalizedRecurrence, type Schedule } from '@echidna-claw/contracts';

const millisecondsPerHour = 60 * 60 * 1000;

const weekdayToOffsetFromSunday: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function toInstant(value: string): Temporal.Instant {
  try {
    return Temporal.Instant.from(value);
  } catch {
    throw new Error(`Invalid ISO timestamp '${value}'`);
  }
}

function getAnchorZonedDateTime(recurrence: NormalizedRecurrence): Temporal.ZonedDateTime {
  return toInstant(recurrence.anchorAt).toZonedDateTimeISO(recurrence.timeZone);
}

function getLocalTime(recurrence: NormalizedRecurrence): Temporal.PlainTime {
  if (recurrence.localTime) {
    return Temporal.PlainTime.from(recurrence.localTime);
  }

  const anchor = getAnchorZonedDateTime(recurrence);
  return new Temporal.PlainTime(anchor.hour, anchor.minute);
}

function getWeekOffsetFromSunday(weekday: string): number {
  const mappedWeekday = weekdayToOffsetFromSunday[weekday];

  if (mappedWeekday === undefined) {
    throw new Error(`Unsupported weekday '${weekday}'`);
  }

  return mappedWeekday;
}

function startOfLocalWeek(date: Temporal.PlainDate): Temporal.PlainDate {
  return date.subtract({ days: date.dayOfWeek % 7 });
}

function createOccurrenceInstant(input: {
  date: Temporal.PlainDate;
  localTime: Temporal.PlainTime;
  timeZone: string;
}): Temporal.Instant {
  return Temporal.ZonedDateTime.from(
    {
      timeZone: input.timeZone,
      year: input.date.year,
      month: input.date.month,
      day: input.date.day,
      hour: input.localTime.hour,
      minute: input.localTime.minute,
      second: input.localTime.second,
      millisecond: input.localTime.millisecond,
      microsecond: input.localTime.microsecond,
      nanosecond: input.localTime.nanosecond,
    },
    {
      disambiguation: 'compatible',
    },
  ).toInstant();
}

function getNextHourlyOccurrence(recurrence: NormalizedRecurrence, after: Temporal.Instant): string {
  const anchor = toInstant(recurrence.anchorAt);
  const intervalMilliseconds = recurrence.interval * millisecondsPerHour;

  if (intervalMilliseconds <= 0) {
    throw new Error('Hourly recurrence interval must be positive.');
  }

  const anchorMilliseconds = anchor.epochMilliseconds;
  const afterMilliseconds = after.epochMilliseconds;
  const steps =
    afterMilliseconds < anchorMilliseconds
      ? 0
      : Math.floor((afterMilliseconds - anchorMilliseconds) / intervalMilliseconds) + 1;

  return new Date(anchorMilliseconds + steps * intervalMilliseconds).toISOString();
}

function getNextDailyOccurrence(recurrence: NormalizedRecurrence, after: Temporal.Instant): string {
  const anchor = getAnchorZonedDateTime(recurrence);
  const anchorInstant = anchor.toInstant();
  const afterDate = after.toZonedDateTimeISO(recurrence.timeZone).toPlainDate();
  const anchorDate = anchor.toPlainDate();
  const localTime = getLocalTime(recurrence);
  const elapsedDays = Math.max(0, afterDate.since(anchorDate, { largestUnit: 'days' }).days);
  let candidateDate = anchorDate.add({
    days: Math.floor(elapsedDays / recurrence.interval) * recurrence.interval,
  });

  for (let iterations = 0; iterations < 366 * 20; iterations += 1) {
    const candidate = createOccurrenceInstant({
      date: candidateDate,
      localTime,
      timeZone: recurrence.timeZone,
    });

    if (
      Temporal.Instant.compare(candidate, anchorInstant) >= 0 &&
      Temporal.Instant.compare(candidate, after) > 0
    ) {
      return candidate.toString();
    }

    candidateDate = candidateDate.add({ days: recurrence.interval });
  }

  throw new Error('Unable to calculate next daily occurrence within search horizon');
}

function getWeeklyOffsets(
  recurrence: NormalizedRecurrence,
  anchorDate: Temporal.PlainDate,
): number[] {
  if (!recurrence.weekdays || recurrence.weekdays.length === 0) {
    return [anchorDate.dayOfWeek % 7];
  }

  return [...new Set(recurrence.weekdays.map((weekday) => getWeekOffsetFromSunday(weekday)))].sort(
    (left, right) => left - right,
  );
}

function getNextWeeklyOccurrence(recurrence: NormalizedRecurrence, after: Temporal.Instant): string {
  const anchor = getAnchorZonedDateTime(recurrence);
  const anchorInstant = anchor.toInstant();
  const anchorDate = anchor.toPlainDate();
  const afterDate = after.toZonedDateTimeISO(recurrence.timeZone).toPlainDate();
  const anchorWeekStart = startOfLocalWeek(anchorDate);
  const afterWeekStart = startOfLocalWeek(afterDate);
  const localTime = getLocalTime(recurrence);
  const weekdayOffsets = getWeeklyOffsets(recurrence, anchorDate);
  const elapsedWeeks = Math.max(
    0,
    Math.floor(afterWeekStart.since(anchorWeekStart, { largestUnit: 'days' }).days / 7),
  );
  let weekOffset = Math.floor(elapsedWeeks / recurrence.interval) * recurrence.interval;

  for (let iterations = 0; iterations < 5200; iterations += 1) {
    const weekStart = anchorWeekStart.add({ weeks: weekOffset });

    for (const weekdayOffset of weekdayOffsets) {
      const candidateDate = weekStart.add({ days: weekdayOffset });
      const candidate = createOccurrenceInstant({
        date: candidateDate,
        localTime,
        timeZone: recurrence.timeZone,
      });

      if (
        Temporal.Instant.compare(candidate, anchorInstant) >= 0 &&
        Temporal.Instant.compare(candidate, after) > 0
      ) {
        return candidate.toString();
      }
    }

    weekOffset += recurrence.interval;
  }

  throw new Error('Unable to calculate next weekly occurrence within search horizon');
}

export function getNextOccurrenceAt(recurrence: NormalizedRecurrence, afterAt: string): string {
  const after = toInstant(afterAt);

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

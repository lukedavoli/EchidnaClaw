import { z } from 'zod';

import {
  isoDateTimeSchema,
  localTimeSchema,
  timeZoneSchema,
  weekdaySchema,
  type HeadTurn,
} from '@echidna-claw/contracts';

import type { ScheduleMutationService } from '../schedule-mutation-service.js';

const recurrenceSchema = z
  .object({
    anchorAt: isoDateTimeSchema.optional(),
    frequency: z.enum(['hourly', 'daily', 'weekly']).optional(),
    interval: z.number().int().positive().optional(),
    localTime: localTimeSchema.optional(),
    timeZone: timeZoneSchema.optional(),
    weekdays: z.array(weekdaySchema).min(1).optional(),
  })
  .strict();

export const changeScheduleArgsSchema = z
  .object({
    action: z.enum(['create', 'update', 'pause', 'resume', 'delete']),
    description: z.string().trim().min(1).optional(),
    naturalLanguageRequest: z.string().trim().min(1).optional(),
    recurrence: recurrenceSchema.optional(),
    scheduleId: z.string().trim().min(1).optional(),
    skipMissedOccurrencesOnRestore: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === 'create') {
      if (!value.description) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Create schedule requires description.',
          path: ['description'],
        });
      }
      if (!value.naturalLanguageRequest) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Create schedule requires naturalLanguageRequest.',
          path: ['naturalLanguageRequest'],
        });
      }
      if (!value.recurrence) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Create schedule requires recurrence.',
          path: ['recurrence'],
        });
      }
    }

    if (value.action !== 'create' && !value.scheduleId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.action} requires scheduleId.`,
        path: ['scheduleId'],
      });
    }
  });

export const changeScheduleToolInputSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['create', 'update', 'pause', 'resume', 'delete'],
    },
    scheduleId: { type: 'string' },
    description: { type: 'string' },
    naturalLanguageRequest: { type: 'string' },
    recurrence: {
      type: 'object',
      properties: {
        frequency: { type: 'string', enum: ['hourly', 'daily', 'weekly'] },
        interval: { type: 'integer', minimum: 1 },
        timeZone: { type: 'string' },
        anchorAt: { type: 'string' },
        localTime: { type: 'string' },
        weekdays: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
          },
        },
      },
      additionalProperties: false,
    },
    skipMissedOccurrencesOnRestore: { type: 'boolean' },
  },
  required: ['action'],
  additionalProperties: false,
};

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}

export async function handleChangeSchedule(input: {
  args: unknown;
  headTurn: HeadTurn;
  scheduleMutationService: ScheduleMutationService;
}): Promise<{
  effectSummaryPatch: {
    scheduleChangeRequested: true;
  };
  outputText: string;
}> {
  const args = changeScheduleArgsSchema.parse(input.args);
  const recurrence = args.recurrence
    ? stripUndefined({
        ...(args.recurrence.anchorAt ? { anchorAt: args.recurrence.anchorAt } : {}),
        ...(args.recurrence.frequency ? { frequency: args.recurrence.frequency } : {}),
        ...(args.recurrence.interval != null ? { interval: args.recurrence.interval } : {}),
        ...(args.recurrence.localTime ? { localTime: args.recurrence.localTime } : {}),
        ...(args.recurrence.timeZone ? { timeZone: args.recurrence.timeZone } : {}),
        ...(args.recurrence.weekdays ? { weekdays: args.recurrence.weekdays } : {}),
      })
    : undefined;
  const result = await input.scheduleMutationService.mutate({
    action: args.action,
    agentId: input.headTurn.agentId,
    correlation: input.headTurn.correlation,
    ...(args.description ? { description: args.description } : {}),
    ...(args.naturalLanguageRequest
      ? { naturalLanguageRequest: args.naturalLanguageRequest }
      : {}),
    ...(recurrence ? { recurrence } : {}),
    ...(args.scheduleId ? { scheduleId: args.scheduleId } : {}),
    ...(args.skipMissedOccurrencesOnRestore != null
      ? { skipMissedOccurrencesOnRestore: args.skipMissedOccurrencesOnRestore }
      : {}),
  });

  return {
    effectSummaryPatch: {
      scheduleChangeRequested: true,
    },
    outputText: result.outputText,
  };
}

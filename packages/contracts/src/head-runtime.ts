import { z } from 'zod';

import { correlationMetadataSchema } from './correlation.js';
import {
  agentIdSchema,
  channelIdSchema,
  headTurnIdSchema,
  inboundMessageIdSchema,
  isoDateTimeSchema,
  scheduleIdSchema,
  taskIdSchema,
} from './identifiers.js';
import {
  headTurnSchema,
  messageBodySchema,
} from './records.js';

export const trustedMessagesTriggerSchema = z
  .object({
    kind: z.literal('trusted_messages'),
    channelId: channelIdSchema,
    inboundMessageIds: z.array(inboundMessageIdSchema).min(1),
    readThroughMessageSequence: z.number().int().positive(),
  })
  .strict();

const dueTaskTriggerBaseSchema = z
  .object({
    kind: z.literal('due_task'),
    taskId: taskIdSchema.optional(),
    scheduleId: scheduleIdSchema.optional(),
    dueAt: isoDateTimeSchema,
  })
  .strict();

export const dueTaskTriggerSchema = dueTaskTriggerBaseSchema.superRefine((value, ctx) => {
  if (value.taskId == null && value.scheduleId == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A due-task trigger must include a taskId or scheduleId.',
      path: ['taskId'],
    });
  }
});

export const headTriggerSchema = z.discriminatedUnion('kind', [
  trustedMessagesTriggerSchema,
  dueTaskTriggerBaseSchema,
]).superRefine((value, ctx) => {
  if (value.kind !== 'due_task') {
    return;
  }

  const dueTask = dueTaskTriggerSchema.safeParse(value);
  if (dueTask.success) {
    return;
  }

  for (const issue of dueTask.error.issues) {
    ctx.addIssue(issue);
  }
});

export const headReplyDraftSchema = z
  .object({
    agentId: agentIdSchema,
    channelId: channelIdSchema,
    inReplyToInboundMessageId: inboundMessageIdSchema.optional(),
    body: messageBodySchema,
  })
  .strict();

export const headEffectSummarySchema = z
  .object({
    taskRequested: z.boolean(),
    scheduleChangeRequested: z.boolean(),
    approvalRequested: z.boolean(),
    sandboxRequested: z.boolean(),
    memoryOperationRequested: z.boolean(),
  })
  .strict();

export const headTurnExecutionStatusSchema = z.enum([
  'replied',
  'no_reply',
  'tool_only',
  'rejected',
  'failed',
  'superseded',
]);

export const headTurnExecutionResultSchema = z
  .object({
    headTurn: headTurnSchema,
    status: headTurnExecutionStatusSchema,
    replyDraft: headReplyDraftSchema.nullable(),
    effectSummary: headEffectSummarySchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === 'replied' && value.replyDraft == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A replied turn must include a reply draft.',
        path: ['replyDraft'],
      });
    }

    if (value.status !== 'replied' && value.replyDraft != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Only replied turns may include a reply draft.',
        path: ['replyDraft'],
      });
    }
  });

export const headStartTurnRequestSchema = z
  .object({
    agentId: agentIdSchema,
    trigger: headTriggerSchema,
    correlation: correlationMetadataSchema,
  })
  .strict();

export const headSupersedeTurnRequestSchema = z
  .object({
    headTurnId: headTurnIdSchema,
    supersededBySequence: z.number().int().positive(),
    correlation: correlationMetadataSchema,
  })
  .strict();

export type TrustedMessagesTrigger = z.infer<typeof trustedMessagesTriggerSchema>;
export type DueTaskTrigger = z.infer<typeof dueTaskTriggerSchema>;
export type HeadTrigger = z.infer<typeof headTriggerSchema>;
export type HeadReplyDraft = z.infer<typeof headReplyDraftSchema>;
export type HeadEffectSummary = z.infer<typeof headEffectSummarySchema>;
export type HeadTurnExecutionStatus = z.infer<typeof headTurnExecutionStatusSchema>;
export type HeadTurnExecutionResult = z.infer<typeof headTurnExecutionResultSchema>;
export type HeadStartTurnRequest = z.infer<typeof headStartTurnRequestSchema>;
export type HeadSupersedeTurnRequest = z.infer<typeof headSupersedeTurnRequestSchema>;

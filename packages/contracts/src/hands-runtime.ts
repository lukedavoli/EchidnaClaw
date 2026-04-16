import { z } from 'zod';

import { correlationMetadataSchema } from './correlation.js';
import {
  agentIdSchema,
  artifactIdSchema,
  handsRunIdSchema,
  isoDateTimeSchema,
  nonEmptyStringSchema,
  taskIdSchema,
  workingContextIdSchema,
} from './identifiers.js';
import {
  externalReferenceSchema,
  queueLaneSchema,
  queuePrioritySchema,
  taskStateSchema,
} from './records.js';
import { enqueueTaskResultSchema } from './task-runtime.js';

export const handsTaskTypeSchema = z.enum(['follow_up', 'system', 'runtime_test']);

export const handsHandlerProgressUpdateSchema = z
  .object({
    artifactIds: z.array(artifactIdSchema).default([]),
    detail: z.string().trim().optional(),
    entryKind: z.enum(['status', 'progress', 'action']).default('progress'),
    handsActionSummary: z.string().trim().optional(),
    headline: nonEmptyStringSchema.optional(),
    level: z.enum(['info', 'warn', 'error']).default('info'),
    message: nonEmptyStringSchema,
    percentComplete: z.number().min(0).max(100).optional(),
    waitingForUser: z.boolean().default(false),
  })
  .strict();

export const handsFollowUpTaskRequestSchema = z
  .object({
    dueAt: isoDateTimeSchema.nullable().default(null),
    externalReferences: z.array(externalReferenceSchema).default([]),
    lane: queueLaneSchema.default('follow_up'),
    notes: z.string().trim().default(''),
    priority: queuePrioritySchema.default('normal'),
    requestedOutcome: nonEmptyStringSchema,
    startRequested: z.boolean().default(true),
    taskType: nonEmptyStringSchema,
  })
  .strict();

export const handsHandlerOutcomeSchema = z.discriminatedUnion('kind', [
  z
    .object({
      artifactIds: z.array(artifactIdSchema).default([]),
      externalReferences: z.array(externalReferenceSchema).default([]),
      followUpTasks: z.array(handsFollowUpTaskRequestSchema).default([]),
      kind: z.literal('completed'),
      resultCode: nonEmptyStringSchema.optional(),
      summary: nonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      artifactIds: z.array(artifactIdSchema).default([]),
      failureCode: nonEmptyStringSchema,
      failureMessage: nonEmptyStringSchema,
      followUpTasks: z.array(handsFollowUpTaskRequestSchema).default([]),
      kind: z.literal('failed'),
      retryable: z.boolean().default(false),
      summary: nonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      followUpTasks: z.array(handsFollowUpTaskRequestSchema).default([]),
      kind: z.literal('waiting_for_user'),
      openQuestions: z.array(nonEmptyStringSchema).default([]),
      summary: nonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      dueAt: isoDateTimeSchema,
      followUpTasks: z.array(handsFollowUpTaskRequestSchema).default([]),
      kind: z.literal('deferred'),
      resultCode: nonEmptyStringSchema.optional(),
      summary: nonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('cancelled'),
      resultCode: nonEmptyStringSchema.optional(),
      summary: nonEmptyStringSchema,
    })
    .strict(),
]);

export const handsCancellationSnapshotSchema = z
  .object({
    requestedAt: isoDateTimeSchema.nullable().default(null),
    reason: z.string().trim().nullable().default(null),
    taskId: taskIdSchema,
    taskState: taskStateSchema,
  })
  .strict();

export const handsCheckpointDecisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('continue') }).strict(),
  z
    .object({
      kind: z.literal('cancel'),
      snapshot: handsCancellationSnapshotSchema,
    })
    .strict(),
]);

export const handsRunStartupOutcomeSchema = z.enum([
  'claimed_new_run',
  'replayed_existing_run',
  'stale_dispatch',
  'agent_busy',
  'claim_failed',
]);

export const handsRunExecutionResultSchema = z
  .object({
    handsRunId: handsRunIdSchema.nullable().default(null),
    resultCode: nonEmptyStringSchema.nullable().default(null),
    startupOutcome: handsRunStartupOutcomeSchema,
    summary: nonEmptyStringSchema,
    taskId: taskIdSchema,
    taskState: taskStateSchema.nullable().default(null),
  })
  .strict();

export const handsEnqueueFollowUpRequestSchema = z
  .object({
    agentId: agentIdSchema,
    correlation: correlationMetadataSchema,
    followUpTasks: z.array(handsFollowUpTaskRequestSchema).min(1),
    handsRunId: handsRunIdSchema,
    taskId: taskIdSchema,
    workingContextId: workingContextIdSchema,
  })
  .strict();

export const handsEnqueueFollowUpResultSchema = z
  .object({
    results: z.array(enqueueTaskResultSchema),
  })
  .strict();

export type HandsTaskType = z.infer<typeof handsTaskTypeSchema>;
export type HandsHandlerProgressUpdate = z.infer<typeof handsHandlerProgressUpdateSchema>;
export type HandsFollowUpTaskRequest = z.infer<typeof handsFollowUpTaskRequestSchema>;
export type HandsHandlerOutcome = z.infer<typeof handsHandlerOutcomeSchema>;
export type HandsCancellationSnapshot = z.infer<typeof handsCancellationSnapshotSchema>;
export type HandsCheckpointDecision = z.infer<typeof handsCheckpointDecisionSchema>;
export type HandsRunStartupOutcome = z.infer<typeof handsRunStartupOutcomeSchema>;
export type HandsRunExecutionResult = z.infer<typeof handsRunExecutionResultSchema>;
export type HandsEnqueueFollowUpRequest = z.infer<typeof handsEnqueueFollowUpRequestSchema>;
export type HandsEnqueueFollowUpResult = z.infer<typeof handsEnqueueFollowUpResultSchema>;

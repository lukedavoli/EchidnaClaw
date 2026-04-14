import { z } from 'zod';

import { correlationMetadataSchema } from './correlation.js';
import {
  agentIdSchema,
  approvalIdSchema,
  headTurnIdSchema,
  isoDateTimeSchema,
  runJournalIdSchema,
  taskEnvelopeIdSchema,
  taskIdSchema,
  workingContextIdSchema,
} from './identifiers.js';
import {
  journalStatusSchema,
  externalReferenceSchema,
  queueDescriptorSchema,
  queueLaneSchema,
  queuePrioritySchema,
  requestedBySchema,
  taskLaunchStateSchema,
  taskProgressSummarySchema,
  taskStateSchema,
} from './records.js';

const taskStatusRunSummarySchema = z
  .object({
    journalId: runJournalIdSchema,
    status: journalStatusSchema,
    summary: z.string().trim().default(''),
    resultCode: z.string().trim().nullable().default(null),
    lastEntryAt: isoDateTimeSchema.nullable(),
    progressSummary: taskProgressSummarySchema.nullable(),
  })
  .strict();

export const taskMergeDispositionSchema = z.enum([
  'created_new_task',
  'merged_into_existing_task',
  'requeued_existing_task',
]);

export const enqueueTaskRequestSchema = z
  .object({
    agentId: agentIdSchema,
    correlation: correlationMetadataSchema,
    dueAt: isoDateTimeSchema.nullable().default(null),
    externalReferences: z.array(externalReferenceSchema).default([]),
    headTurnId: headTurnIdSchema.nullable().default(null),
    lane: queueLaneSchema,
    notes: z.string().trim().default(''),
    priority: queuePrioritySchema.default('normal'),
    requestedBy: requestedBySchema,
    requestedOutcome: z.string().trim().min(1),
    startRequested: z.boolean().default(true),
    taskType: z.string().trim().min(1),
    workingContextId: workingContextIdSchema,
    workingContextSummary: z.string().trim().default(''),
  })
  .strict();

export const requestQueuedTaskStartRequestSchema = z
  .object({
    agentId: agentIdSchema,
    correlation: correlationMetadataSchema,
    requestedAt: isoDateTimeSchema.optional(),
    taskId: taskIdSchema,
  })
  .strict();

export const requestQueuedTaskStartResultSchema = z
  .object({
    adapterAccepted: z.boolean(),
    attempted: z.boolean(),
    errorCode: z.string().trim().nullable().default(null),
    errorMessage: z.string().trim().nullable().default(null),
    replayed: z.boolean(),
    taskEnvelopeId: taskEnvelopeIdSchema,
    taskId: taskIdSchema,
  })
  .strict();

export const enqueueTaskResultSchema = z
  .object({
    disposition: taskMergeDispositionSchema,
    runJournalId: runJournalIdSchema,
    startRequest: requestQueuedTaskStartResultSchema.nullable(),
    taskEnvelopeId: taskEnvelopeIdSchema,
    taskId: taskIdSchema,
  })
  .strict();

export const taskStatusItemSchema = z
  .object({
    activeApprovalId: approvalIdSchema.nullable(),
    currentRunJournalId: runJournalIdSchema.nullable(),
    dueAt: isoDateTimeSchema.nullable(),
    launchState: taskLaunchStateSchema,
    progressSummary: taskProgressSummarySchema.nullable(),
    queue: queueDescriptorSchema,
    requestedOutcome: z.string().trim().min(1),
    runSummary: taskStatusRunSummarySchema.nullable(),
    state: taskStateSchema,
    taskId: taskIdSchema,
    taskType: z.string().trim().min(1),
  })
  .strict();

export const taskStatusSnapshotSchema = z
  .object({
    activeTaskId: taskIdSchema.nullable(),
    openTasks: z.array(taskStatusItemSchema),
    pendingApprovalIds: z.array(approvalIdSchema),
    workingContextId: workingContextIdSchema,
    workingContextSummary: z.string().trim().default(''),
  })
  .strict();

export type TaskMergeDisposition = z.infer<typeof taskMergeDispositionSchema>;
export type EnqueueTaskRequest = z.infer<typeof enqueueTaskRequestSchema>;
export type RequestQueuedTaskStartRequest = z.infer<typeof requestQueuedTaskStartRequestSchema>;
export type RequestQueuedTaskStartResult = z.infer<typeof requestQueuedTaskStartResultSchema>;
export type EnqueueTaskResult = z.infer<typeof enqueueTaskResultSchema>;
export type TaskStatusItem = z.infer<typeof taskStatusItemSchema>;
export type TaskStatusSnapshot = z.infer<typeof taskStatusSnapshotSchema>;

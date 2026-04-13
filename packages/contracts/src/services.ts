import { z } from 'zod';

import { correlationMetadataSchema } from './correlation.js';
import {
  agentIdSchema,
  approvalIdSchema,
  handsRunIdSchema,
  headTurnIdSchema,
  inboundMessageIdSchema,
  isoDateTimeSchema,
  nonEmptyStringSchema,
  sandboxSessionIdSchema,
  taskEnvelopeIdSchema,
  taskIdSchema,
  workingContextIdSchema,
} from './identifiers.js';
import {
  Agent,
  HandsRun,
  HeadTurn,
  OutboundMessage,
  SandboxSession,
  Task,
  UsageEvent,
  approvalStateSchema,
  usageEventSchema,
} from './records.js';

export const headStartTurnRequestSchema = z
  .object({
    agentId: agentIdSchema,
    workingContextId: workingContextIdSchema,
    inboundMessageIds: z.array(inboundMessageIdSchema).min(1),
    readThroughMessageSequence: z.number().int().positive(),
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

export const handsStartRunRequestSchema = z
  .object({
    taskId: taskIdSchema,
    taskEnvelopeId: taskEnvelopeIdSchema,
    correlation: correlationMetadataSchema,
  })
  .strict();

export const handsReleaseForUserRequestSchema = z
  .object({
    handsRunId: handsRunIdSchema,
    releasedAt: isoDateTimeSchema,
    approvalId: approvalIdSchema.optional(),
    correlation: correlationMetadataSchema,
  })
  .strict();

export const sandboxCreateSessionRequestSchema = z
  .object({
    taskId: taskIdSchema,
    handsRunId: handsRunIdSchema,
    policyName: nonEmptyStringSchema,
    workingDirectory: nonEmptyStringSchema.optional(),
    correlation: correlationMetadataSchema,
  })
  .strict();

export const schedulerMaterializeDueSchedulesRequestSchema = z
  .object({
    asOf: isoDateTimeSchema,
    correlation: correlationMetadataSchema,
  })
  .strict();

export const webCreateAgentRequestSchema = z
  .object({
    name: nonEmptyStringSchema,
    timeZone: nonEmptyStringSchema,
    correlation: correlationMetadataSchema,
  })
  .strict();

export const webSoftDeleteAgentRequestSchema = z
  .object({
    agentId: agentIdSchema,
    correlation: correlationMetadataSchema,
  })
  .strict();

export const webRestoreAgentRequestSchema = z
  .object({
    agentId: agentIdSchema,
    correlation: correlationMetadataSchema,
  })
  .strict();

export const analyticsOverviewSchema = z
  .object({
    totalEstimatedCostUsd: z.number().finite().nonnegative(),
    totalInputTokens: z.number().int().nonnegative(),
    totalOutputTokens: z.number().int().nonnegative(),
    events: z.array(usageEventSchema),
  })
  .strict();

export type HeadStartTurnRequest = z.infer<typeof headStartTurnRequestSchema>;
export type HeadSupersedeTurnRequest = z.infer<typeof headSupersedeTurnRequestSchema>;
export type HandsStartRunRequest = z.infer<typeof handsStartRunRequestSchema>;
export type HandsReleaseForUserRequest = z.infer<typeof handsReleaseForUserRequestSchema>;
export type SandboxCreateSessionRequest = z.infer<typeof sandboxCreateSessionRequestSchema>;
export type SchedulerMaterializeDueSchedulesRequest = z.infer<typeof schedulerMaterializeDueSchedulesRequestSchema>;
export type WebCreateAgentRequest = z.infer<typeof webCreateAgentRequestSchema>;
export type WebSoftDeleteAgentRequest = z.infer<typeof webSoftDeleteAgentRequestSchema>;
export type WebRestoreAgentRequest = z.infer<typeof webRestoreAgentRequestSchema>;
export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>;

export interface HeadService {
  startTurn(input: HeadStartTurnRequest): Promise<HeadTurn>;
  supersedeTurn(input: HeadSupersedeTurnRequest): Promise<HeadTurn>;
  createTask(task: Task): Promise<Task>;
  sendMessage(message: OutboundMessage): Promise<OutboundMessage>;
}

export interface HandsService {
  startRun(input: HandsStartRunRequest): Promise<HandsRun>;
  releaseForUser(input: HandsReleaseForUserRequest): Promise<HandsRun>;
  completeTask(task: Task): Promise<Task>;
}

export interface SandboxService {
  createSession(input: SandboxCreateSessionRequest): Promise<SandboxSession>;
  closeSession(sessionId: z.infer<typeof sandboxSessionIdSchema>): Promise<SandboxSession>;
}

export interface SchedulerService {
  materializeDueSchedules(input: SchedulerMaterializeDueSchedulesRequest): Promise<Task[]>;
}

export interface WebControlPlaneService {
  createAgent(input: WebCreateAgentRequest): Promise<Agent>;
  listAgents(): Promise<Agent[]>;
  softDeleteAgent(input: WebSoftDeleteAgentRequest): Promise<Agent>;
  restoreAgent(input: WebRestoreAgentRequest): Promise<Agent>;
  getApprovalState(approvalId: z.infer<typeof approvalIdSchema>): Promise<z.infer<typeof approvalStateSchema>>;
  getAnalyticsOverview(): Promise<AnalyticsOverview>;
}

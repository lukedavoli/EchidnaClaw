import { z } from 'zod';

import { correlationMetadataSchema } from './correlation.js';
import {
  type HeadStartTurnRequest,
  type HeadSupersedeTurnRequest,
  type HeadTurnExecutionResult,
} from './head-runtime.js';
import {
  agentIdSchema,
  approvalIdSchema,
  channelIdSchema,
  credentialIdSchema,
  handsRunIdSchema,
  inboundMessageIdSchema,
  isoDateTimeSchema,
  messageSequenceSchema,
  nonEmptyStringSchema,
  positiveIntegerSchema,
  sandboxSessionIdSchema,
  taskEnvelopeIdSchema,
  taskIdSchema,
  timeZoneSchema,
} from './identifiers.js';
import {
  agentSchema,
  channelStateSchema,
  HandsRun,
  HeadTurn,
  outboundMessageActionSchema,
  SandboxSession,
  Task,
  approvalStateSchema,
  usageEventSchema,
} from './records.js';

export const handsStartRunRequestSchema = z
  .object({
    taskId: taskIdSchema,
    taskEnvelopeId: taskEnvelopeIdSchema,
    attemptNumber: positiveIntegerSchema,
    dispatchIdempotencyKey: nonEmptyStringSchema,
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
    timeZone: timeZoneSchema.optional(),
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

export const webRetryAgentProvisioningRequestSchema = z
  .object({
    agentId: agentIdSchema,
    correlation: correlationMetadataSchema,
  })
  .strict();

export const adminPrimaryChannelSummarySchema = z
  .object({
    id: channelIdSchema,
    provider: z.literal('telegram'),
    state: channelStateSchema,
    externalHandle: nonEmptyStringSchema.optional(),
    externalChatId: nonEmptyStringSchema.optional(),
    botUserId: nonEmptyStringSchema.optional(),
    botDisplayName: nonEmptyStringSchema.optional(),
    credentialId: credentialIdSchema.optional(),
    provisioningRequestedAt: isoDateTimeSchema,
    provisioningStartedAt: isoDateTimeSchema.nullable(),
    boundAt: isoDateTimeSchema.nullable(),
    lastProvisioningFailedAt: isoDateTimeSchema.nullable(),
    lastProvisioningErrorCode: nonEmptyStringSchema.optional(),
    lastProvisioningErrorMessage: nonEmptyStringSchema.optional(),
    recoveryAttemptCount: z.number().int().nonnegative(),
    lastRecoveryRequestedAt: isoDateTimeSchema.nullable(),
    conversationUrl: nonEmptyStringSchema.optional(),
  })
  .strict();

export const adminAgentSummarySchema = z
  .object({
    agent: agentSchema,
    primaryChannel: adminPrimaryChannelSummarySchema.nullable(),
  })
  .strict();

export const adminAgentDetailSchema = adminAgentSummarySchema;

export const completeAgentProvisioningRequestSchema = z
  .object({
    agentId: agentIdSchema,
    botUserId: nonEmptyStringSchema,
    botDisplayName: nonEmptyStringSchema.optional(),
    boundAt: isoDateTimeSchema.optional(),
    correlation: correlationMetadataSchema,
    credentialId: credentialIdSchema.optional(),
    externalChatId: nonEmptyStringSchema.optional(),
    externalHandle: nonEmptyStringSchema.optional(),
  })
  .strict();

export const recordAgentProvisioningFailureRequestSchema = z
  .object({
    agentId: agentIdSchema,
    correlation: correlationMetadataSchema,
    errorCode: nonEmptyStringSchema.optional(),
    errorMessage: nonEmptyStringSchema.optional(),
    failedAt: isoDateTimeSchema.optional(),
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

export const sendChannelMessageRequestSchema = z
  .object({
    agentId: agentIdSchema,
    channelId: channelIdSchema,
    correlation: correlationMetadataSchema,
    inReplyToInboundMessageId: inboundMessageIdSchema.optional(),
    actions: z.array(outboundMessageActionSchema).default([]),
    text: nonEmptyStringSchema,
  })
  .strict();

export const trustedChannelIngressDispatchRequestSchema = z
  .object({
    agentId: agentIdSchema,
    channelId: channelIdSchema,
    inboundMessageId: inboundMessageIdSchema,
    readThroughMessageSequence: messageSequenceSchema,
    correlation: correlationMetadataSchema,
  })
  .strict();

export const approvalDecisionChannelActionResponseSchema = z
  .object({
    kind: z.literal('approval_decision'),
    agentId: agentIdSchema,
    channelId: channelIdSchema,
    approvalId: approvalIdSchema,
    decision: z.enum(['approve', 'reject']),
    inboundMessageId: inboundMessageIdSchema,
    correlation: correlationMetadataSchema,
  })
  .strict();

export const channelActionResponseSchema = z.discriminatedUnion('kind', [
  approvalDecisionChannelActionResponseSchema,
]);

export type HandsStartRunRequest = z.infer<typeof handsStartRunRequestSchema>;
export type HandsReleaseForUserRequest = z.infer<typeof handsReleaseForUserRequestSchema>;
export type SandboxCreateSessionRequest = z.infer<typeof sandboxCreateSessionRequestSchema>;
export type SchedulerMaterializeDueSchedulesRequest = z.infer<
  typeof schedulerMaterializeDueSchedulesRequestSchema
>;
export type WebCreateAgentRequest = z.infer<typeof webCreateAgentRequestSchema>;
export type WebSoftDeleteAgentRequest = z.infer<typeof webSoftDeleteAgentRequestSchema>;
export type WebRestoreAgentRequest = z.infer<typeof webRestoreAgentRequestSchema>;
export type WebRetryAgentProvisioningRequest = z.infer<typeof webRetryAgentProvisioningRequestSchema>;
export type AdminPrimaryChannelSummary = z.infer<typeof adminPrimaryChannelSummarySchema>;
export type AdminAgentSummary = z.infer<typeof adminAgentSummarySchema>;
export type AdminAgentDetail = z.infer<typeof adminAgentDetailSchema>;
export type CompleteAgentProvisioningRequest = z.infer<typeof completeAgentProvisioningRequestSchema>;
export type RecordAgentProvisioningFailureRequest = z.infer<
  typeof recordAgentProvisioningFailureRequestSchema
>;
export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>;
export type SendChannelMessageRequest = z.infer<typeof sendChannelMessageRequestSchema>;
export type TrustedChannelIngressDispatchRequest = z.infer<
  typeof trustedChannelIngressDispatchRequestSchema
>;
export type ApprovalDecisionChannelActionResponse = z.infer<
  typeof approvalDecisionChannelActionResponseSchema
>;
export type ChannelActionResponse = z.infer<typeof channelActionResponseSchema>;

export interface HeadService {
  startTurn(input: HeadStartTurnRequest): Promise<HeadTurnExecutionResult>;
  supersedeTurn(input: HeadSupersedeTurnRequest): Promise<HeadTurn>;
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
  createAgent(input: WebCreateAgentRequest): Promise<AdminAgentDetail>;
  getAgent(agentId: z.infer<typeof agentIdSchema>): Promise<AdminAgentDetail>;
  listAgents(): Promise<AdminAgentSummary[]>;
  retryAgentProvisioning(input: WebRetryAgentProvisioningRequest): Promise<AdminAgentDetail>;
  softDeleteAgent(input: WebSoftDeleteAgentRequest): Promise<AdminAgentDetail>;
  restoreAgent(input: WebRestoreAgentRequest): Promise<AdminAgentDetail>;
  completeAgentProvisioning(input: CompleteAgentProvisioningRequest): Promise<AdminAgentDetail>;
  recordAgentProvisioningFailure(input: RecordAgentProvisioningFailureRequest): Promise<AdminAgentDetail>;
  getApprovalState(approvalId: z.infer<typeof approvalIdSchema>): Promise<z.infer<typeof approvalStateSchema>>;
  getAnalyticsOverview(): Promise<AnalyticsOverview>;
}

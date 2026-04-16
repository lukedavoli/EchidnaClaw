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
  artifactIdSchema,
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
    agentId: agentIdSchema,
    taskId: taskIdSchema,
    handsRunId: handsRunIdSchema,
    policyName: nonEmptyStringSchema,
    packageAllowlistName: nonEmptyStringSchema.optional(),
    credentialAliases: z.array(nonEmptyStringSchema).default([]),
    workingDirectory: nonEmptyStringSchema.optional(),
    workspaceLabel: nonEmptyStringSchema.optional(),
    correlation: correlationMetadataSchema,
  })
  .strict();

export const sandboxProvisionSessionRequestSchema = sandboxCreateSessionRequestSchema
  .extend({
    sessionId: sandboxSessionIdSchema,
  })
  .strict();

export const sandboxShellSchema = z.enum(['default', 'bash', 'pwsh']);

export const sandboxCommandStatusSchema = z.enum([
  'completed',
  'failed',
  'timed_out',
  'cancelled',
  'policy_denied',
]);

export const sandboxExecuteCommandRequestSchema = z
  .object({
    sessionId: sandboxSessionIdSchema,
    command: nonEmptyStringSchema,
    shell: sandboxShellSchema.default('default'),
    timeoutMs: positiveIntegerSchema.optional(),
    workingDirectory: nonEmptyStringSchema.optional(),
    correlation: correlationMetadataSchema,
  })
  .strict();

export const sandboxExecuteCommandResultSchema = z
  .object({
    sessionId: sandboxSessionIdSchema,
    status: sandboxCommandStatusSchema,
    startedAt: isoDateTimeSchema,
    completedAt: isoDateTimeSchema,
    durationMs: z.number().int().nonnegative(),
    exitCode: z.number().int().nullable(),
    signal: z.string().trim().nullable(),
    stdoutText: z.string(),
    stderrText: z.string(),
    outputTruncated: z.boolean(),
    resolvedWorkingDirectory: nonEmptyStringSchema,
    artifactIds: z.array(artifactIdSchema).default([]),
    failureCode: nonEmptyStringSchema.optional(),
    failureMessage: z.string().trim().optional(),
  })
  .strict();

export const sandboxCloseSessionRequestSchema = z
  .object({
    sessionId: sandboxSessionIdSchema,
    reason: z.enum(['completed', 'cancelled', 'cleanup']).default('completed'),
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
export type SandboxProvisionSessionRequest = z.infer<typeof sandboxProvisionSessionRequestSchema>;
export type SandboxShell = z.infer<typeof sandboxShellSchema>;
export type SandboxCommandStatus = z.infer<typeof sandboxCommandStatusSchema>;
export type SandboxExecuteCommandRequest = z.infer<typeof sandboxExecuteCommandRequestSchema>;
export type SandboxExecuteCommandResult = z.infer<typeof sandboxExecuteCommandResultSchema>;
export type SandboxCloseSessionRequest = z.infer<typeof sandboxCloseSessionRequestSchema>;
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
  executeCommand(input: SandboxExecuteCommandRequest): Promise<SandboxExecuteCommandResult>;
  getSession(sessionId: z.infer<typeof sandboxSessionIdSchema>): Promise<SandboxSession>;
  closeSession(input: SandboxCloseSessionRequest): Promise<SandboxSession>;
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

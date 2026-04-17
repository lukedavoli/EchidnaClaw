import { z } from 'zod';

import { correlationMetadataSchema } from './correlation.js';
import {
  type HeadStartTurnRequest,
  type HeadSupersedeTurnRequest,
  type HeadTurnExecutionResult,
} from './head-runtime.js';
import {
  type HandsEnqueueFollowUpRequest,
  type HandsEnqueueFollowUpResult,
} from './hands-runtime.js';
import {
  agentIdSchema,
  approvalIdSchema,
  artifactIdSchema,
  channelIdSchema,
  credentialCaptureIdSchema,
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
  approvalStateSchema,
  channelStateSchema,
  credentialStatusSchema,
  HandsRun,
  HeadTurn,
  outboundMessageActionSchema,
  SandboxSession,
  sandboxCredentialBindingSchema,
  usageEventSchema,
} from './records.js';

export const handsStartRunRequestSchema = z
  .object({
    agentId: agentIdSchema,
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
    credentialCaptureId: credentialCaptureIdSchema.optional(),
    correlation: correlationMetadataSchema,
  })
  .strict();

export const handsDispatchResultSchema = z
  .object({
    acceptedAt: isoDateTimeSchema,
    dispatchIdempotencyKey: nonEmptyStringSchema,
    dispatchMode: z.enum(['in_process', 'http', 'one_shot']),
    dispatchReference: nonEmptyStringSchema,
    taskEnvelopeId: taskEnvelopeIdSchema,
    taskId: taskIdSchema,
  })
  .strict();

export const sandboxCreateSessionRequestSchema = z
  .object({
    agentId: agentIdSchema,
    taskId: taskIdSchema,
    handsRunId: handsRunIdSchema,
    policyName: nonEmptyStringSchema,
    packageAllowlistName: nonEmptyStringSchema.optional(),
    credentialBindings: z.array(sandboxCredentialBindingSchema).default([]),
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

export const schedulerProcessDueWorkRequestSchema = z
  .object({
    asOf: isoDateTimeSchema,
    maxBatchSize: positiveIntegerSchema.optional(),
    maxPasses: positiveIntegerSchema.optional(),
    correlation: correlationMetadataSchema,
  })
  .strict();

export const schedulerProcessDueWorkResultSchema = z
  .object({
    activeHeadConflictCount: z.number().int().nonnegative(),
    asOf: isoDateTimeSchema,
    failureCount: z.number().int().nonnegative(),
    launchedDueTaskTurnCount: z.number().int().nonnegative(),
    launchedTaskIds: z.array(taskIdSchema).default([]),
    materializedScheduleCount: z.number().int().nonnegative(),
    materializedTaskIds: z.array(taskIdSchema).default([]),
    skippedByIdempotencyCount: z.number().int().nonnegative(),
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

export const adminCredentialSummarySchema = z
  .object({
    accessPolicyRef: nonEmptyStringSchema,
    alias: nonEmptyStringSchema,
    credentialId: credentialIdSchema,
    displayName: nonEmptyStringSchema,
    expiresAt: isoDateTimeSchema.nullable(),
    lastRotatedAt: isoDateTimeSchema.nullable(),
    lastUsedAt: isoDateTimeSchema.nullable(),
    provider: nonEmptyStringSchema,
    replacedByCredentialId: credentialIdSchema.nullable(),
    revokedAt: isoDateTimeSchema.nullable(),
    status: credentialStatusSchema,
  })
  .strict();

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

export const webRevokeCredentialRequestSchema = z
  .object({
    agentId: agentIdSchema,
    correlation: correlationMetadataSchema,
    credentialId: credentialIdSchema,
  })
  .strict();

export const analyticsWindowSchema = z.enum(['1h', '24h', '7d', '30d', '90d', 'all']);
export const analyticsTimeGrainSchema = z.enum(['minute', 'hour', 'day', 'week']);

export const analyticsTotalsSchema = z
  .object({
    estimatedCostUsd: z.number().finite().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative().nullable(),
    toolInputTokens: z.number().int().nonnegative().nullable(),
    toolOutputTokens: z.number().int().nonnegative().nullable(),
    eventCount: z.number().int().nonnegative(),
  })
  .strict();

export const analyticsModelSliceSchema = z
  .object({
    model: nonEmptyStringSchema,
    estimatedCostUsd: z.number().finite().nonnegative(),
    eventCount: z.number().int().nonnegative(),
  })
  .strict();

export const analyticsSourceSliceSchema = z
  .object({
    source: nonEmptyStringSchema,
    estimatedCostUsd: z.number().finite().nonnegative(),
    eventCount: z.number().int().nonnegative(),
  })
  .strict();

export const analyticsAgentSliceSchema = z
  .object({
    agentId: agentIdSchema,
    agentName: nonEmptyStringSchema,
    estimatedCostUsd: z.number().finite().nonnegative(),
    eventCount: z.number().int().nonnegative(),
  })
  .strict();

export const analyticsSeriesPointSchema = z
  .object({
    bucketStart: isoDateTimeSchema,
    estimatedCostUsd: z.number().finite().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    eventCount: z.number().int().nonnegative(),
  })
  .strict();

export const analyticsOverviewSchema = z
  .object({
    window: analyticsWindowSchema,
    grain: analyticsTimeGrainSchema,
    totals: analyticsTotalsSchema,
    byModel: z.array(analyticsModelSliceSchema),
    bySource: z.array(analyticsSourceSliceSchema),
    topAgents: z.array(analyticsAgentSliceSchema),
    series: z.array(analyticsSeriesPointSchema),
    events: z.array(usageEventSchema),
  })
  .strict();

export const analyticsAgentSummarySchema = z
  .object({
    agentId: agentIdSchema,
    agentName: nonEmptyStringSchema,
    window: analyticsWindowSchema,
    grain: analyticsTimeGrainSchema,
    totals: analyticsTotalsSchema,
    byModel: z.array(analyticsModelSliceSchema),
    bySource: z.array(analyticsSourceSliceSchema),
    series: z.array(analyticsSeriesPointSchema),
    events: z.array(usageEventSchema),
  })
  .strict();

export const analyticsSeriesResponseSchema = z
  .object({
    agentId: agentIdSchema.optional(),
    window: analyticsWindowSchema,
    grain: analyticsTimeGrainSchema,
    series: z.array(analyticsSeriesPointSchema),
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
export type HandsDispatchResult = z.infer<typeof handsDispatchResultSchema>;
export type SandboxCreateSessionRequest = z.infer<typeof sandboxCreateSessionRequestSchema>;
export type SandboxProvisionSessionRequest = z.infer<typeof sandboxProvisionSessionRequestSchema>;
export type SandboxShell = z.infer<typeof sandboxShellSchema>;
export type SandboxCommandStatus = z.infer<typeof sandboxCommandStatusSchema>;
export type SandboxExecuteCommandRequest = z.infer<typeof sandboxExecuteCommandRequestSchema>;
export type SandboxExecuteCommandResult = z.infer<typeof sandboxExecuteCommandResultSchema>;
export type SandboxCloseSessionRequest = z.infer<typeof sandboxCloseSessionRequestSchema>;
export type SchedulerProcessDueWorkRequest = z.infer<typeof schedulerProcessDueWorkRequestSchema>;
export type SchedulerProcessDueWorkResult = z.infer<typeof schedulerProcessDueWorkResultSchema>;
export type WebCreateAgentRequest = z.infer<typeof webCreateAgentRequestSchema>;
export type WebSoftDeleteAgentRequest = z.infer<typeof webSoftDeleteAgentRequestSchema>;
export type WebRestoreAgentRequest = z.infer<typeof webRestoreAgentRequestSchema>;
export type WebRetryAgentProvisioningRequest = z.infer<typeof webRetryAgentProvisioningRequestSchema>;
export type AdminPrimaryChannelSummary = z.infer<typeof adminPrimaryChannelSummarySchema>;
export type AdminAgentSummary = z.infer<typeof adminAgentSummarySchema>;
export type AdminAgentDetail = z.infer<typeof adminAgentDetailSchema>;
export type AdminCredentialSummary = z.infer<typeof adminCredentialSummarySchema>;
export type CompleteAgentProvisioningRequest = z.infer<typeof completeAgentProvisioningRequestSchema>;
export type RecordAgentProvisioningFailureRequest = z.infer<
  typeof recordAgentProvisioningFailureRequestSchema
>;
export type WebRevokeCredentialRequest = z.infer<typeof webRevokeCredentialRequestSchema>;
export type AnalyticsWindow = z.infer<typeof analyticsWindowSchema>;
export type AnalyticsTimeGrain = z.infer<typeof analyticsTimeGrainSchema>;
export type AnalyticsTotals = z.infer<typeof analyticsTotalsSchema>;
export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>;
export type AnalyticsAgentSummary = z.infer<typeof analyticsAgentSummarySchema>;
export type AnalyticsSeriesPoint = z.infer<typeof analyticsSeriesPointSchema>;
export type AnalyticsSeriesResponse = z.infer<typeof analyticsSeriesResponseSchema>;
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
  enqueueFollowUpTasks(input: HandsEnqueueFollowUpRequest): Promise<HandsEnqueueFollowUpResult>;
  releaseForUser(input: HandsReleaseForUserRequest): Promise<HandsRun>;
  startRun(input: HandsStartRunRequest): Promise<HandsDispatchResult>;
}

export interface SandboxService {
  createSession(input: SandboxCreateSessionRequest): Promise<SandboxSession>;
  executeCommand(input: SandboxExecuteCommandRequest): Promise<SandboxExecuteCommandResult>;
  getSession(sessionId: z.infer<typeof sandboxSessionIdSchema>): Promise<SandboxSession>;
  closeSession(input: SandboxCloseSessionRequest): Promise<SandboxSession>;
}

export interface SchedulerService {
  processDueWork(input: SchedulerProcessDueWorkRequest): Promise<SchedulerProcessDueWorkResult>;
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
  listCredentials(agentId: z.infer<typeof agentIdSchema>): Promise<AdminCredentialSummary[]>;
  revokeCredential(input: WebRevokeCredentialRequest): Promise<AdminCredentialSummary>;
  getAnalyticsOverview(window?: AnalyticsWindow): Promise<AnalyticsOverview>;
  getAgentAnalytics(
    agentId: z.infer<typeof agentIdSchema>,
    window?: AnalyticsWindow,
  ): Promise<AnalyticsAgentSummary>;
  getAnalyticsSeries(input?: {
    agentId?: z.infer<typeof agentIdSchema>;
    window?: AnalyticsWindow;
  }): Promise<AnalyticsSeriesResponse>;
}

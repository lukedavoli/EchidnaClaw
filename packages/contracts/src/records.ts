import { z } from 'zod';

import { correlationMetadataSchema } from './correlation.js';
import {
  agentIdSchema,
  approvalIdSchema,
  artifactIdSchema,
  channelIdSchema,
  credentialIdSchema,
  credentialSecretIdSchema,
  handsRunIdSchema,
  headTurnIdSchema,
  idempotencyRecordIdSchema,
  inboundMessageIdSchema,
  isoDateTimeSchema,
  localTimeSchema,
  localDateSchema,
  messageSequenceSchema,
  modelIdSchema,
  nonEmptyStringSchema,
  nonNegativeNumberSchema,
  outboundMessageIdSchema,
  positiveIntegerSchema,
  recordReferenceSchema,
  runJournalEntryIdSchema,
  runJournalIdSchema,
  sandboxSessionIdSchema,
  scheduleIdSchema,
  schemaVersionSchema,
  taskEnvelopeIdSchema,
  taskIdSchema,
  timeZoneSchema,
  usageEventIdSchema,
  weekdaySchema,
  workingContextIdSchema,
} from './identifiers.js';

export const artifactLinkSchema = z
  .object({
    artifactId: artifactIdSchema,
    label: nonEmptyStringSchema.optional(),
  })
  .strict();

export const externalReferenceSchema = z
  .object({
    type: z.enum(['artifact', 'url', 'credential', 'channel_message']),
    reference: nonEmptyStringSchema,
  })
  .strict();

export const messageBodySchema = z
  .object({
    text: z.string().trim().default(''),
    artifacts: z.array(artifactLinkSchema).default([]),
  })
  .strict();

export const inboundMessageKindSchema = z.enum(['text', 'callback_query', 'unsupported']);

export const telegramMessageSenderSchema = z
  .object({
    provider: z.literal('telegram'),
    externalUserId: nonEmptyStringSchema,
    externalUserHandle: nonEmptyStringSchema.optional(),
    displayName: nonEmptyStringSchema.optional(),
  })
  .strict();

export const outboundMessageActionSchema = z
  .object({
    kind: z.literal('approval_decision'),
    approvalId: approvalIdSchema,
    decision: z.enum(['approve', 'reject']),
    label: nonEmptyStringSchema,
  })
  .strict();

export const requestedBySchema = z
  .object({
    kind: z.enum(['user', 'schedule', 'system']),
    sourceMessageId: inboundMessageIdSchema.optional(),
    sourceScheduleId: scheduleIdSchema.optional(),
  })
  .strict();

const recurrenceSchema = z
  .object({
    frequency: z.enum(['hourly', 'daily', 'weekly']),
    interval: positiveIntegerSchema.default(1),
    timeZone: timeZoneSchema,
    anchorAt: isoDateTimeSchema,
    localTime: localTimeSchema.optional(),
    weekdays: z.array(weekdaySchema).min(1).optional(),
  })
  .strict();

export const queueLaneSchema = z.enum([
  'user_requested',
  'follow_up',
  'scheduled',
  'system',
]);

export const queuePrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);

export const queueDescriptorSchema = z
  .object({
    lane: queueLaneSchema.default('user_requested'),
    priority: queuePrioritySchema,
    sequence: positiveIntegerSchema.optional(),
  })
  .strict();

export const progressActorSchema = z.enum(['head', 'hands', 'scheduler', 'system']);

export const taskProgressSummarySchema = z
  .object({
    headline: nonEmptyStringSchema,
    detail: z.string().trim().optional(),
    percentComplete: z.number().min(0).max(100).optional(),
    waitingForUser: z.boolean(),
    lastActor: progressActorSchema,
  })
  .strict();

export const taskProgressSummaryPatchSchema = taskProgressSummarySchema.partial();

export const taskLaunchStatusSchema = z.enum(['not_requested', 'requested', 'failed']);

export const taskLaunchStateSchema = z
  .object({
    status: taskLaunchStatusSchema.default('not_requested'),
    requestedAt: isoDateTimeSchema.nullable().default(null),
    lastAttemptAt: isoDateTimeSchema.nullable().default(null),
    lastIdempotencyKey: nonEmptyStringSchema.nullable().default(null),
    attemptCount: z.number().int().nonnegative().default(0),
    lastErrorCode: nonEmptyStringSchema.optional(),
    lastErrorMessage: z.string().trim().optional(),
  })
  .strict();

const tokenUsageSchema = z
  .object({
    inputTokens: nonNegativeNumberSchema,
    outputTokens: nonNegativeNumberSchema,
  })
  .strict();

const usageSourceSchema = z.enum(['head', 'hands', 'sandbox', 'scheduler', 'web_control_plane']);
export const journalStatusSchema = z.enum(['open', 'closed', 'failed']);
const credentialStatusSchema = z.enum(['active', 'revoked']);
const idempotencyStatusSchema = z.enum(['reserved', 'completed', 'expired']);
export const runJournalEntryKindSchema = z.enum([
  'status',
  'progress',
  'action',
  'waiting',
  'completion',
  'failure',
]);

export const taskStateSchema = z.enum([
  'queued',
  'running',
  'waiting_for_user',
  'completed',
  'failed',
  'cancelled',
  'deferred',
]);
export const approvalStateSchema = z.enum(['requested', 'approved', 'rejected', 'expired', 'cancelled']);
export const agentProvisioningStateSchema = z.enum([
  'pending_provisioning',
  'provisioning',
  'provisioning_failed',
  'active',
]);
export const softDeleteStateSchema = z.enum(['active', 'soft_deleted']);
export const headTurnStateSchema = z.enum(['queued', 'running', 'superseded', 'completed', 'failed']);
export const headTriggerKindSchema = z.enum(['trusted_messages', 'due_task']);
export const headTurnCompletionKindSchema = z.enum([
  'reply',
  'tool_only',
  'no_op',
  'rejected',
  'failed',
]);
export const handsRunStateSchema = z.enum([
  'queued',
  'running',
  'waiting_for_user',
  'completed',
  'failed',
  'cancelled',
]);
export const sandboxSessionStateSchema = z.enum(['created', 'running', 'completed', 'failed', 'cancelled']);
export const scheduleStateSchema = z.enum(['active', 'paused', 'soft_deleted']);
export const channelStateSchema = z.enum([
  'pending_provisioning',
  'provisioning',
  'provisioning_failed',
  'active',
  'retired',
]);
export const outboundDeliveryStateSchema = z.enum(['queued', 'sent', 'delivered', 'failed']);

function createRecordSchema<TRecordType extends string, TShape extends z.ZodRawShape>(
  recordType: TRecordType,
  idSchema: z.ZodTypeAny,
  shape: TShape,
) {
  return z
    .object({
      id: idSchema,
      recordType: z.literal(recordType),
      schemaVersion: schemaVersionSchema,
      createdAt: isoDateTimeSchema,
      updatedAt: isoDateTimeSchema,
      correlation: correlationMetadataSchema,
    })
    .extend(shape)
    .strict();
}

export const agentSchema = createRecordSchema('agent', agentIdSchema, {
  name: nonEmptyStringSchema,
  timeZone: timeZoneSchema,
  headModel: modelIdSchema.default('gpt-5.4-mini'),
  primaryChannelId: channelIdSchema,
  provisioningState: agentProvisioningStateSchema,
  lifecycleState: softDeleteStateSchema,
  softDeletedAt: isoDateTimeSchema.nullable(),
  restoredAt: isoDateTimeSchema.nullable(),
  factoryProfileVersion: nonEmptyStringSchema,
  responsibilitiesSummary: z.string().trim().default(''),
});

export const channelSchema = createRecordSchema('channel', channelIdSchema, {
  agentId: agentIdSchema,
  provider: z.enum(['telegram']),
  state: channelStateSchema,
  externalHandle: nonEmptyStringSchema.optional(),
  externalChatId: nonEmptyStringSchema.optional(),
  botUserId: nonEmptyStringSchema.optional(),
  botDisplayName: nonEmptyStringSchema.optional(),
  credentialId: credentialIdSchema.optional(),
  trustedExternalUserId: nonEmptyStringSchema.optional(),
  trustedExternalUserHandle: nonEmptyStringSchema.optional(),
  trustedExternalDisplayName: nonEmptyStringSchema.optional(),
  provisioningRequestedAt: isoDateTimeSchema,
  provisioningStartedAt: isoDateTimeSchema.nullable().default(null),
  boundAt: isoDateTimeSchema.nullable().default(null),
  lastProvisioningFailedAt: isoDateTimeSchema.nullable().default(null),
  lastProvisioningErrorCode: nonEmptyStringSchema.optional(),
  lastProvisioningErrorMessage: nonEmptyStringSchema.optional(),
  recoveryAttemptCount: z.number().int().nonnegative().default(0),
  lastRecoveryRequestedAt: isoDateTimeSchema.nullable().default(null),
  lastInboundSequence: messageSequenceSchema,
  lastInboundReceivedAt: isoDateTimeSchema.nullable().default(null),
  lastOutboundSentAt: isoDateTimeSchema.nullable().default(null),
  lastInboundExternalMessageId: nonEmptyStringSchema.optional(),
  lastOutboundExternalMessageId: nonEmptyStringSchema.optional(),
  lastExternalMessageId: nonEmptyStringSchema.optional(),
});

export const inboundMessageSchema = createRecordSchema('inbound_message', inboundMessageIdSchema, {
  agentId: agentIdSchema,
  channelId: channelIdSchema,
  sequence: positiveIntegerSchema,
  kind: inboundMessageKindSchema.default('text'),
  receivedAt: isoDateTimeSchema,
  externalChatId: nonEmptyStringSchema.optional(),
  externalMessageId: nonEmptyStringSchema.optional(),
  externalUpdateId: nonEmptyStringSchema.optional(),
  trusted: z.boolean(),
  sender: telegramMessageSenderSchema.optional(),
  callbackData: nonEmptyStringSchema.optional(),
  unsupportedType: nonEmptyStringSchema.optional(),
  body: messageBodySchema,
});

export const outboundMessageSchema = createRecordSchema('outbound_message', outboundMessageIdSchema, {
  agentId: agentIdSchema,
  channelId: channelIdSchema,
  inReplyToInboundMessageId: inboundMessageIdSchema.optional(),
  deliveryState: outboundDeliveryStateSchema,
  requestedAt: isoDateTimeSchema,
  sentAt: isoDateTimeSchema.nullable().default(null),
  failedAt: isoDateTimeSchema.nullable().default(null),
  deliveredAt: isoDateTimeSchema.nullable(),
  externalMessageId: nonEmptyStringSchema.optional(),
  failureCode: nonEmptyStringSchema.optional(),
  failureMessage: nonEmptyStringSchema.optional(),
  actions: z.array(outboundMessageActionSchema).default([]),
  body: messageBodySchema,
});

export const workingContextSchema = createRecordSchema('working_context', workingContextIdSchema, {
  agentId: agentIdSchema,
  latestInboundSequence: messageSequenceSchema,
  latestProcessedSequence: messageSequenceSchema,
  activeHeadTurnId: headTurnIdSchema.nullable(),
  activeHeadTurnStartedAt: isoDateTimeSchema.nullable(),
  activeHeadTurnReadThroughSequence: messageSequenceSchema.nullable(),
  pendingSupersededBySequence: messageSequenceSchema.nullable(),
  debounceUntil: isoDateTimeSchema.nullable(),
  pendingDebounceSequence: messageSequenceSchema.nullable(),
  episodeLocalDate: localDateSchema.nullable(),
  episodeTurnCount: z.number().int().nonnegative(),
  activeTaskId: taskIdSchema.nullable(),
  summary: z.string().trim().default(''),
  summaryUpdatedAt: isoDateTimeSchema.nullable(),
  currentObjective: z.string().trim().nullable(),
  latestHandsStatus: z.string().trim().nullable(),
  openQuestions: z.array(nonEmptyStringSchema).default([]),
  conversationCursor: nonEmptyStringSchema.optional(),
  openTaskIds: z.array(taskIdSchema).default([]),
  pendingApprovalIds: z.array(approvalIdSchema).default([]),
});

export const taskSchema = createRecordSchema('task', taskIdSchema, {
  agentId: agentIdSchema,
  type: nonEmptyStringSchema,
  state: taskStateSchema,
  queue: queueDescriptorSchema,
  requestedOutcome: nonEmptyStringSchema,
  requestedBy: requestedBySchema,
  dueAt: isoDateTimeSchema.nullable(),
  stateEnteredAt: isoDateTimeSchema,
  scheduleId: scheduleIdSchema.optional(),
  activeTaskEnvelopeId: taskEnvelopeIdSchema.nullable().default(null),
  currentRunJournalId: runJournalIdSchema.nullable().default(null),
  currentHandsRunId: handsRunIdSchema.nullable(),
  activeApprovalId: approvalIdSchema.nullable(),
  mergeKey: nonEmptyStringSchema.nullable().default(null),
  mergedIntoTaskId: taskIdSchema.nullable().default(null),
  attemptCount: z.number().int().positive().default(1),
  launchState: taskLaunchStateSchema.default({
    status: 'not_requested',
    requestedAt: null,
    lastAttemptAt: null,
    lastIdempotencyKey: null,
    attemptCount: 0,
  }),
  progressSummary: taskProgressSummarySchema.nullable().default(null),
  lastProgressAt: isoDateTimeSchema.nullable().default(null),
  completedAt: isoDateTimeSchema.nullable().default(null),
  failedAt: isoDateTimeSchema.nullable().default(null),
  cancelledAt: isoDateTimeSchema.nullable().default(null),
  artifactIds: z.array(artifactIdSchema).default([]),
  externalReferences: z.array(externalReferenceSchema).default([]),
  notes: z.string().trim().default(''),
});

export const taskEnvelopeSchema = createRecordSchema('task_envelope', taskEnvelopeIdSchema, {
  taskId: taskIdSchema,
  agentId: agentIdSchema,
  taskType: nonEmptyStringSchema,
  requestedOutcome: nonEmptyStringSchema,
  requestedBy: requestedBySchema,
  queue: queueDescriptorSchema,
  dueAt: isoDateTimeSchema.nullable(),
  sourceHeadTurnId: headTurnIdSchema.nullable().default(null),
  workingContextSummary: z.string().trim().default(''),
  mergeKey: nonEmptyStringSchema.nullable().default(null),
  attemptNumber: positiveIntegerSchema.default(1),
  supersedesEnvelopeId: taskEnvelopeIdSchema.nullable().default(null),
  dispatchIdempotencyKey: nonEmptyStringSchema.nullable().default(null),
  approvalState: approvalStateSchema.optional(),
  artifactIds: z.array(artifactIdSchema).default([]),
  credentialIds: z.array(credentialIdSchema).default([]),
  externalReferences: z.array(externalReferenceSchema).default([]),
  notes: z.string().trim().default(''),
});

export const approvalSchema = createRecordSchema('approval', approvalIdSchema, {
  agentId: agentIdSchema,
  taskId: taskIdSchema,
  state: approvalStateSchema,
  requestedAt: isoDateTimeSchema,
  decidedAt: isoDateTimeSchema.nullable(),
  blocking: z.boolean(),
  summary: nonEmptyStringSchema,
  decisionReason: z.string().trim().default(''),
  expiresAt: isoDateTimeSchema.nullable(),
});

export const scheduleSchema = createRecordSchema('schedule', scheduleIdSchema, {
  agentId: agentIdSchema,
  state: scheduleStateSchema,
  description: nonEmptyStringSchema,
  naturalLanguageRequest: nonEmptyStringSchema,
  recurrence: recurrenceSchema,
  nextDueAt: isoDateTimeSchema.nullable(),
  lastMaterializedOccurrenceAt: isoDateTimeSchema.nullable(),
  skipMissedOccurrencesOnRestore: z.literal(true).default(true),
});

export const artifactSchema = createRecordSchema('artifact', artifactIdSchema, {
  agentId: agentIdSchema,
  storageKind: z.enum(['blob']),
  blobPath: nonEmptyStringSchema,
  contentType: nonEmptyStringSchema,
  sizeBytes: nonNegativeNumberSchema,
  retentionUntil: isoDateTimeSchema.nullable(),
});

export const credentialRefSchema = createRecordSchema('credential_ref', credentialIdSchema, {
  agentId: agentIdSchema,
  provider: nonEmptyStringSchema,
  alias: nonEmptyStringSchema,
  scope: z.enum(['agent', 'platform']),
  status: credentialStatusSchema,
  accessPolicyRef: nonEmptyStringSchema,
  encryptionKeyRef: nonEmptyStringSchema,
  lastRotatedAt: isoDateTimeSchema.nullable(),
  revokedAt: isoDateTimeSchema.nullable(),
  expiresAt: isoDateTimeSchema.nullable(),
});

export const credentialSecretSchema = createRecordSchema(
  'credential_secret',
  credentialSecretIdSchema,
  {
    agentId: agentIdSchema,
    credentialId: credentialIdSchema,
    envelopeVersion: z.literal(1),
    encryptionAlgorithm: z.literal('AES-256-GCM'),
    wrappingAlgorithm: z.literal('RSA-OAEP-256'),
    keyEncryptionKeyId: nonEmptyStringSchema,
    wrappedDataKey: nonEmptyStringSchema,
    initializationVector: nonEmptyStringSchema,
    authenticationTag: nonEmptyStringSchema,
    ciphertext: nonEmptyStringSchema,
  },
);

export const idempotencyRecordSchema = createRecordSchema(
  'idempotency_record',
  idempotencyRecordIdSchema,
  {
    agentId: agentIdSchema,
    scope: nonEmptyStringSchema,
    key: nonEmptyStringSchema,
    status: idempotencyStatusSchema,
    resultReference: recordReferenceSchema.nullable(),
    expiresAt: isoDateTimeSchema.nullable(),
  },
);

export const usageEventSchema = createRecordSchema('usage_event', usageEventIdSchema, {
  agentId: agentIdSchema,
  source: usageSourceSchema,
  model: modelIdSchema,
  operation: nonEmptyStringSchema,
  occurredAt: isoDateTimeSchema,
  tokens: tokenUsageSchema,
  estimatedCostUsd: nonNegativeNumberSchema,
});

export const runJournalSchema = createRecordSchema('run_journal', runJournalIdSchema, {
  agentId: agentIdSchema,
  scope: z.enum(['head_turn', 'hands_run', 'scheduler']),
  scopeId: nonEmptyStringSchema,
  taskId: taskIdSchema.nullable().default(null),
  handsRunId: handsRunIdSchema.nullable().default(null),
  status: journalStatusSchema,
  openedAt: isoDateTimeSchema,
  closedAt: isoDateTimeSchema.nullable(),
  summary: z.string().trim().default(''),
  progressSummary: taskProgressSummarySchema.nullable().default(null),
  lastEntryAt: isoDateTimeSchema.nullable().default(null),
  resultCode: nonEmptyStringSchema.nullable().default(null),
});

export const runJournalEntrySchema = createRecordSchema('run_journal_entry', runJournalEntryIdSchema, {
  journalId: runJournalIdSchema,
  agentId: agentIdSchema,
  entryKind: runJournalEntryKindSchema,
  level: z.enum(['info', 'warn', 'error']),
  recordedAt: isoDateTimeSchema,
  message: nonEmptyStringSchema,
  taskStateAfter: taskStateSchema.nullable().default(null),
  progressSummaryPatch: taskProgressSummaryPatchSchema.nullable().default(null),
  artifactIds: z.array(artifactIdSchema).default([]),
  approvalId: approvalIdSchema.nullable().default(null),
  handsActionSummary: z.string().trim().optional(),
});

export const headTurnSchema = createRecordSchema('head_turn', headTurnIdSchema, {
  agentId: agentIdSchema,
  workingContextId: workingContextIdSchema,
  state: headTurnStateSchema,
  triggerKind: headTriggerKindSchema,
  inboundMessageIds: z.array(inboundMessageIdSchema).default([]),
  readThroughMessageSequence: positiveIntegerSchema.nullable(),
  taskId: taskIdSchema.nullable(),
  scheduleId: scheduleIdSchema.nullable(),
  dueAt: isoDateTimeSchema.nullable(),
  claimedAt: isoDateTimeSchema,
  startedAt: isoDateTimeSchema.nullable(),
  completedAt: isoDateTimeSchema.nullable(),
  staleCheckedAt: isoDateTimeSchema.nullable(),
  episodeLocalDate: localDateSchema.nullable(),
  episodeTurnIndex: positiveIntegerSchema.nullable(),
  supersededBySequence: messageSequenceSchema.nullable(),
  providerConversationId: nonEmptyStringSchema.nullable(),
  providerRunId: nonEmptyStringSchema.nullable(),
  promptProfileVersion: nonEmptyStringSchema,
  completionKind: headTurnCompletionKindSchema.nullable(),
  failureCode: nonEmptyStringSchema.optional(),
  failureMessage: z.string().trim().optional(),
  responseMessageId: outboundMessageIdSchema.nullable(),
});

export const handsRunSchema = createRecordSchema('hands_run', handsRunIdSchema, {
  agentId: agentIdSchema,
  taskId: taskIdSchema,
  taskEnvelopeId: taskEnvelopeIdSchema,
  state: handsRunStateSchema,
  startedAt: isoDateTimeSchema.nullable(),
  completedAt: isoDateTimeSchema.nullable(),
  releasedAt: isoDateTimeSchema.nullable(),
});

export const sandboxSessionSchema = createRecordSchema('sandbox_session', sandboxSessionIdSchema, {
  agentId: agentIdSchema,
  handsRunId: handsRunIdSchema,
  taskId: taskIdSchema,
  state: sandboxSessionStateSchema,
  policyName: nonEmptyStringSchema,
  workingDirectory: nonEmptyStringSchema.optional(),
  allowedOutboundHosts: z.array(nonEmptyStringSchema).default([]),
  startedAt: isoDateTimeSchema.nullable(),
  completedAt: isoDateTimeSchema.nullable(),
});

export type ArtifactLink = z.infer<typeof artifactLinkSchema>;
export type ExternalReference = z.infer<typeof externalReferenceSchema>;
export type MessageBody = z.infer<typeof messageBodySchema>;
export type InboundMessageKind = z.infer<typeof inboundMessageKindSchema>;
export type TelegramMessageSender = z.infer<typeof telegramMessageSenderSchema>;
export type OutboundMessageAction = z.infer<typeof outboundMessageActionSchema>;
export type RequestedBy = z.infer<typeof requestedBySchema>;
export type QueueLane = z.infer<typeof queueLaneSchema>;
export type QueuePriority = z.infer<typeof queuePrioritySchema>;
export type NormalizedRecurrence = z.infer<typeof recurrenceSchema>;
export type QueueDescriptor = z.infer<typeof queueDescriptorSchema>;
export type ProgressActor = z.infer<typeof progressActorSchema>;
export type TaskProgressSummary = z.infer<typeof taskProgressSummarySchema>;
export type TaskProgressSummaryPatch = z.infer<typeof taskProgressSummaryPatchSchema>;
export type TaskLaunchStatus = z.infer<typeof taskLaunchStatusSchema>;
export type TaskLaunchState = z.infer<typeof taskLaunchStateSchema>;
export type TokenUsage = z.infer<typeof tokenUsageSchema>;
export type UsageSource = z.infer<typeof usageSourceSchema>;
export type JournalStatus = z.infer<typeof journalStatusSchema>;
export type CredentialStatus = z.infer<typeof credentialStatusSchema>;
export type IdempotencyStatus = z.infer<typeof idempotencyStatusSchema>;
export type RunJournalEntryKind = z.infer<typeof runJournalEntryKindSchema>;
export type TaskState = z.infer<typeof taskStateSchema>;
export type ApprovalState = z.infer<typeof approvalStateSchema>;
export type AgentProvisioningState = z.infer<typeof agentProvisioningStateSchema>;
export type SoftDeleteState = z.infer<typeof softDeleteStateSchema>;
export type HeadTurnState = z.infer<typeof headTurnStateSchema>;
export type HeadTriggerKind = z.infer<typeof headTriggerKindSchema>;
export type HeadTurnCompletionKind = z.infer<typeof headTurnCompletionKindSchema>;
export type HandsRunState = z.infer<typeof handsRunStateSchema>;
export type SandboxSessionState = z.infer<typeof sandboxSessionStateSchema>;
export type ScheduleState = z.infer<typeof scheduleStateSchema>;
export type ChannelState = z.infer<typeof channelStateSchema>;
export type OutboundDeliveryState = z.infer<typeof outboundDeliveryStateSchema>;
export type Agent = z.infer<typeof agentSchema>;
export type Channel = z.infer<typeof channelSchema>;
export type InboundMessage = z.infer<typeof inboundMessageSchema>;
export type OutboundMessage = z.infer<typeof outboundMessageSchema>;
export type WorkingContext = z.infer<typeof workingContextSchema>;
export type Task = z.infer<typeof taskSchema>;
export type TaskEnvelope = z.infer<typeof taskEnvelopeSchema>;
export type Approval = z.infer<typeof approvalSchema>;
export type Schedule = z.infer<typeof scheduleSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type CredentialRef = z.infer<typeof credentialRefSchema>;
export type CredentialSecret = z.infer<typeof credentialSecretSchema>;
export type IdempotencyRecord = z.infer<typeof idempotencyRecordSchema>;
export type UsageEvent = z.infer<typeof usageEventSchema>;
export type RunJournal = z.infer<typeof runJournalSchema>;
export type RunJournalEntry = z.infer<typeof runJournalEntrySchema>;
export type HeadTurn = z.infer<typeof headTurnSchema>;
export type HandsRun = z.infer<typeof handsRunSchema>;
export type SandboxSession = z.infer<typeof sandboxSessionSchema>;

export const platformRecordSchema = z.discriminatedUnion('recordType', [
  agentSchema,
  channelSchema,
  inboundMessageSchema,
  outboundMessageSchema,
  workingContextSchema,
  taskSchema,
  taskEnvelopeSchema,
  approvalSchema,
  scheduleSchema,
  artifactSchema,
  credentialRefSchema,
  credentialSecretSchema,
  idempotencyRecordSchema,
  usageEventSchema,
  runJournalSchema,
  runJournalEntrySchema,
  headTurnSchema,
  handsRunSchema,
  sandboxSessionSchema,
]);

export type PlatformRecord = z.infer<typeof platformRecordSchema>;

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

const artifactLinkSchema = z
  .object({
    artifactId: artifactIdSchema,
    label: nonEmptyStringSchema.optional(),
  })
  .strict();

const externalReferenceSchema = z
  .object({
    type: z.enum(['artifact', 'url', 'credential', 'channel_message']),
    reference: nonEmptyStringSchema,
  })
  .strict();

const messageBodySchema = z
  .object({
    text: nonEmptyStringSchema,
    artifacts: z.array(artifactLinkSchema).default([]),
  })
  .strict();

const requestedBySchema = z
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

const queueDescriptorSchema = z
  .object({
    priority: z.enum(['low', 'normal', 'high', 'urgent']),
    sequence: positiveIntegerSchema.optional(),
  })
  .strict();

const tokenUsageSchema = z
  .object({
    inputTokens: nonNegativeNumberSchema,
    outputTokens: nonNegativeNumberSchema,
  })
  .strict();

const usageSourceSchema = z.enum(['head', 'hands', 'sandbox', 'scheduler', 'web_control_plane']);
const journalStatusSchema = z.enum(['open', 'closed', 'failed']);
const credentialStatusSchema = z.enum(['active', 'revoked']);
const idempotencyStatusSchema = z.enum(['reserved', 'completed', 'expired']);

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
export const channelStateSchema = z.enum(['pending_provisioning', 'active', 'provisioning_failed', 'retired']);
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
  lastInboundSequence: messageSequenceSchema,
  lastExternalMessageId: nonEmptyStringSchema.optional(),
});

export const inboundMessageSchema = createRecordSchema('inbound_message', inboundMessageIdSchema, {
  agentId: agentIdSchema,
  channelId: channelIdSchema,
  sequence: positiveIntegerSchema,
  receivedAt: isoDateTimeSchema,
  externalMessageId: nonEmptyStringSchema.optional(),
  externalUpdateId: nonEmptyStringSchema.optional(),
  trusted: z.boolean(),
  body: messageBodySchema,
});

export const outboundMessageSchema = createRecordSchema('outbound_message', outboundMessageIdSchema, {
  agentId: agentIdSchema,
  channelId: channelIdSchema,
  inReplyToInboundMessageId: inboundMessageIdSchema.optional(),
  deliveryState: outboundDeliveryStateSchema,
  requestedAt: isoDateTimeSchema,
  deliveredAt: isoDateTimeSchema.nullable(),
  externalMessageId: nonEmptyStringSchema.optional(),
  body: messageBodySchema,
});

export const workingContextSchema = createRecordSchema('working_context', workingContextIdSchema, {
  agentId: agentIdSchema,
  lastTrustedMessageSequence: messageSequenceSchema,
  activeHeadTurnId: headTurnIdSchema.nullable(),
  activeTaskId: taskIdSchema.nullable(),
  summary: z.string().trim().default(''),
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
  currentHandsRunId: handsRunIdSchema.nullable(),
  activeApprovalId: approvalIdSchema.nullable(),
  artifactIds: z.array(artifactIdSchema).default([]),
  externalReferences: z.array(externalReferenceSchema).default([]),
  notes: z.string().trim().default(''),
});

export const taskEnvelopeSchema = createRecordSchema('task_envelope', taskEnvelopeIdSchema, {
  taskId: taskIdSchema,
  agentId: agentIdSchema,
  taskType: nonEmptyStringSchema,
  requestedOutcome: nonEmptyStringSchema,
  queue: queueDescriptorSchema,
  dueAt: isoDateTimeSchema.nullable(),
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
  status: journalStatusSchema,
  openedAt: isoDateTimeSchema,
  closedAt: isoDateTimeSchema.nullable(),
  summary: z.string().trim().default(''),
});

export const runJournalEntrySchema = createRecordSchema('run_journal_entry', runJournalEntryIdSchema, {
  journalId: runJournalIdSchema,
  agentId: agentIdSchema,
  level: z.enum(['info', 'warn', 'error']),
  recordedAt: isoDateTimeSchema,
  message: nonEmptyStringSchema,
  handsActionSummary: z.string().trim().optional(),
});

export const headTurnSchema = createRecordSchema('head_turn', headTurnIdSchema, {
  agentId: agentIdSchema,
  state: headTurnStateSchema,
  inboundMessageIds: z.array(inboundMessageIdSchema).min(1),
  readThroughMessageSequence: positiveIntegerSchema,
  startedAt: isoDateTimeSchema.nullable(),
  completedAt: isoDateTimeSchema.nullable(),
  supersededBySequence: messageSequenceSchema.nullable(),
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
export type RequestedBy = z.infer<typeof requestedBySchema>;
export type NormalizedRecurrence = z.infer<typeof recurrenceSchema>;
export type QueueDescriptor = z.infer<typeof queueDescriptorSchema>;
export type TokenUsage = z.infer<typeof tokenUsageSchema>;
export type UsageSource = z.infer<typeof usageSourceSchema>;
export type JournalStatus = z.infer<typeof journalStatusSchema>;
export type CredentialStatus = z.infer<typeof credentialStatusSchema>;
export type IdempotencyStatus = z.infer<typeof idempotencyStatusSchema>;
export type TaskState = z.infer<typeof taskStateSchema>;
export type ApprovalState = z.infer<typeof approvalStateSchema>;
export type AgentProvisioningState = z.infer<typeof agentProvisioningStateSchema>;
export type SoftDeleteState = z.infer<typeof softDeleteStateSchema>;
export type HeadTurnState = z.infer<typeof headTurnStateSchema>;
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

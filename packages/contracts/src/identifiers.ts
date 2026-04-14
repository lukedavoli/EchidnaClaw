import { z } from 'zod';

const identifierBodyPattern = '[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?';

function createIdentifierSchema(prefix: string) {
  return z
    .string()
    .regex(new RegExp(`^${prefix}_${identifierBodyPattern}$`), `Expected ${prefix}_... identifier`);
}

export const schemaVersionSchema = z.literal(1);
export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const nonEmptyStringSchema = z.string().trim().min(1);
export const timeZoneSchema = nonEmptyStringSchema;
export const localTimeSchema = z.string().regex(/^\d{2}:\d{2}$/);
export const messageSequenceSchema = z.number().int().nonnegative();
export const nonNegativeNumberSchema = z.number().finite().nonnegative();
export const positiveIntegerSchema = z.number().int().positive();

export const agentIdSchema = createIdentifierSchema('agt');
export const channelIdSchema = createIdentifierSchema('chn');
export const inboundMessageIdSchema = createIdentifierSchema('inm');
export const outboundMessageIdSchema = createIdentifierSchema('out');
export const workingContextIdSchema = createIdentifierSchema('ctx');
export const taskIdSchema = createIdentifierSchema('tsk');
export const taskEnvelopeIdSchema = createIdentifierSchema('env');
export const approvalIdSchema = createIdentifierSchema('apr');
export const scheduleIdSchema = createIdentifierSchema('sch');
export const artifactIdSchema = createIdentifierSchema('art');
export const credentialIdSchema = createIdentifierSchema('crd');
export const credentialSecretIdSchema = createIdentifierSchema('cse');
export const idempotencyRecordIdSchema = createIdentifierSchema('idr');
export const usageEventIdSchema = createIdentifierSchema('use');
export const runJournalIdSchema = createIdentifierSchema('rjn');
export const runJournalEntryIdSchema = createIdentifierSchema('rje');
export const headTurnIdSchema = createIdentifierSchema('hdr');
export const handsRunIdSchema = createIdentifierSchema('hnd');
export const sandboxSessionIdSchema = createIdentifierSchema('sbx');
export const traceIdSchema = createIdentifierSchema('trc');
export const operatorIdSchema = createIdentifierSchema('opr');
export const idempotencyKeySchema = createIdentifierSchema('idem');
export const analyticsKeySchema = createIdentifierSchema('anl');
export const scheduleOccurrenceKeySchema = createIdentifierSchema('occ');
export const channelUpdateKeySchema = createIdentifierSchema('upd');
export const recordReferenceSchema = nonEmptyStringSchema;

export const weekdaySchema = z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
export const modelIdSchema = z.enum(['gpt-5.4-mini']);

export type SchemaVersion = z.infer<typeof schemaVersionSchema>;
export type LocalDate = z.infer<typeof localDateSchema>;
export type AgentId = z.infer<typeof agentIdSchema>;
export type ChannelId = z.infer<typeof channelIdSchema>;
export type InboundMessageId = z.infer<typeof inboundMessageIdSchema>;
export type OutboundMessageId = z.infer<typeof outboundMessageIdSchema>;
export type WorkingContextId = z.infer<typeof workingContextIdSchema>;
export type TaskId = z.infer<typeof taskIdSchema>;
export type TaskEnvelopeId = z.infer<typeof taskEnvelopeIdSchema>;
export type ApprovalId = z.infer<typeof approvalIdSchema>;
export type ScheduleId = z.infer<typeof scheduleIdSchema>;
export type ArtifactId = z.infer<typeof artifactIdSchema>;
export type CredentialId = z.infer<typeof credentialIdSchema>;
export type CredentialSecretId = z.infer<typeof credentialSecretIdSchema>;
export type IdempotencyRecordId = z.infer<typeof idempotencyRecordIdSchema>;
export type UsageEventId = z.infer<typeof usageEventIdSchema>;
export type RunJournalId = z.infer<typeof runJournalIdSchema>;
export type RunJournalEntryId = z.infer<typeof runJournalEntryIdSchema>;
export type HeadTurnId = z.infer<typeof headTurnIdSchema>;
export type HandsRunId = z.infer<typeof handsRunIdSchema>;
export type SandboxSessionId = z.infer<typeof sandboxSessionIdSchema>;
export type TraceId = z.infer<typeof traceIdSchema>;
export type OperatorId = z.infer<typeof operatorIdSchema>;
export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;
export type AnalyticsKey = z.infer<typeof analyticsKeySchema>;
export type ScheduleOccurrenceKey = z.infer<typeof scheduleOccurrenceKeySchema>;
export type ChannelUpdateKey = z.infer<typeof channelUpdateKeySchema>;
export type RecordReference = z.infer<typeof recordReferenceSchema>;
export type Weekday = z.infer<typeof weekdaySchema>;
export type ModelId = z.infer<typeof modelIdSchema>;

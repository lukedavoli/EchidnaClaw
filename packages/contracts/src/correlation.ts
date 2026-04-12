import { z } from 'zod';

import {
  analyticsKeySchema,
  approvalIdSchema,
  channelUpdateKeySchema,
  handsRunIdSchema,
  headTurnIdSchema,
  idempotencyKeySchema,
  inboundMessageIdSchema,
  nonEmptyStringSchema,
  operatorIdSchema,
  outboundMessageIdSchema,
  recordReferenceSchema,
  sandboxSessionIdSchema,
  scheduleIdSchema,
  scheduleOccurrenceKeySchema,
  taskIdSchema,
  traceIdSchema,
} from './identifiers.js';

export const actorKindSchema = z.enum(['operator', 'agent', 'scheduler', 'system', 'telegram']);

export const actorMetadataSchema = z
  .object({
    kind: actorKindSchema,
    id: z.union([operatorIdSchema, nonEmptyStringSchema]),
    displayName: nonEmptyStringSchema.optional(),
  })
  .strict();

export const externalMessageReferenceSchema = z
  .object({
    provider: z.enum(['telegram']),
    externalChatId: nonEmptyStringSchema,
    externalMessageId: nonEmptyStringSchema.optional(),
    externalUpdateId: nonEmptyStringSchema.optional(),
  })
  .strict();

export const correlationMetadataSchema = z
  .object({
    traceId: traceIdSchema,
    causationId: recordReferenceSchema.optional(),
    idempotencyKey: idempotencyKeySchema,
    analyticsKey: analyticsKeySchema.optional(),
    taskId: taskIdSchema.optional(),
    approvalId: approvalIdSchema.optional(),
    scheduleId: scheduleIdSchema.optional(),
    scheduleOccurrenceKey: scheduleOccurrenceKeySchema.optional(),
    headTurnId: headTurnIdSchema.optional(),
    handsRunId: handsRunIdSchema.optional(),
    sandboxSessionId: sandboxSessionIdSchema.optional(),
    inboundMessageId: inboundMessageIdSchema.optional(),
    outboundMessageId: outboundMessageIdSchema.optional(),
    channelUpdateKey: channelUpdateKeySchema.optional(),
    externalMessage: externalMessageReferenceSchema.optional(),
    requestedBy: actorMetadataSchema.optional(),
  })
  .strict();

export type ActorKind = z.infer<typeof actorKindSchema>;
export type ActorMetadata = z.infer<typeof actorMetadataSchema>;
export type ExternalMessageReference = z.infer<typeof externalMessageReferenceSchema>;
export type CorrelationMetadata = z.infer<typeof correlationMetadataSchema>;

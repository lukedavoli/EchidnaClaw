import { correlationMetadataSchema, type CorrelationMetadata } from '@echidna-claw/contracts';

function createIdentifier(prefix: 'idem' | 'trc') {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function createMutationCorrelation(): CorrelationMetadata {
  return correlationMetadataSchema.parse({
    idempotencyKey: createIdentifier('idem'),
    requestedBy: {
      displayName: 'Web Control Plane',
      id: 'opr_web-control-plane',
      kind: 'operator',
    },
    traceId: createIdentifier('trc'),
  });
}

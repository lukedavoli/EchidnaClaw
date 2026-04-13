import { correlationMetadataSchema } from '@echidna-claw/contracts';
import { describe, expect, it } from 'vitest';

import { createMutationCorrelation } from './correlation.js';

describe('createMutationCorrelation', () => {
  it('creates valid operator-scoped correlation metadata', () => {
    const correlation = createMutationCorrelation();

    expect(correlationMetadataSchema.parse(correlation)).toMatchObject({
      requestedBy: {
        id: 'opr_web-control-plane',
        kind: 'operator',
      },
    });
    expect(correlation.traceId).toMatch(/^trc_/);
    expect(correlation.idempotencyKey).toMatch(/^idem_/);
  });
});

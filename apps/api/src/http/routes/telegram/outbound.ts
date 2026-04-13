import {
  agentIdSchema,
  channelIdSchema,
  correlationMetadataSchema,
  nonEmptyStringSchema,
} from '@echidna-claw/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { bindRequestCorrelation } from '../../request-context.js';

const outboundMessageRequestSchema = z
  .object({
    agentId: agentIdSchema,
    channelId: channelIdSchema,
    correlation: correlationMetadataSchema,
    text: nonEmptyStringSchema,
  })
  .strict();

export function registerOutboundMessagingRoutes(app: FastifyInstance): void {
  app.post('/messages', async (request, reply) => {
    const body = outboundMessageRequestSchema.parse(
      request.body,
    ) as z.infer<typeof outboundMessageRequestSchema>;
    bindRequestCorrelation(request, {
      agentId: body.agentId,
      correlation: body.correlation,
    });

    await app.dependencies.services.outboundMessagingService.sendMessage(body);
    reply.code(202);

    return {
      accepted: true,
      status: 'queued',
    };
  });
}

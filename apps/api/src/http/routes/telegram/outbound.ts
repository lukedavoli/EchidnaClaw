import { sendChannelMessageRequestSchema } from '@echidna-claw/contracts';
import type { FastifyInstance } from 'fastify';

import { bindRequestCorrelation } from '../../request-context.js';

export function registerOutboundMessagingRoutes(app: FastifyInstance): void {
  app.post('/messages', async (request, reply) => {
    const body = sendChannelMessageRequestSchema.parse(request.body);
    bindRequestCorrelation(request, {
      agentId: body.agentId,
      correlation: body.correlation,
    });

    const message = await app.dependencies.services.outboundMessagingService.sendMessage(body);
    reply.code(202);

    return {
      accepted: true,
      outboundMessageId: message.id,
      status: message.deliveryState,
    };
  });
}

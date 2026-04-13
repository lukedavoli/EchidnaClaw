import { channelIdSchema } from '@echidna-claw/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { parseTelegramWebhookUpdate } from '../../../services/channel/telegram-normalization.js';

const telegramWebhookParamsSchema = z
  .object({
    channelId: channelIdSchema,
  })
  .strict();

export function registerTelegramWebhookRoutes(app: FastifyInstance): void {
  app.post('/:channelId/webhook', async (request) => {
    const params = telegramWebhookParamsSchema.parse(request.params);
    const body = parseTelegramWebhookUpdate(request.body);

    await app.dependencies.services.telegramIngressService.handleWebhook({
      channelId: params.channelId,
      update: body,
    });

    return { accepted: true, kind: 'webhook' };
  });
}

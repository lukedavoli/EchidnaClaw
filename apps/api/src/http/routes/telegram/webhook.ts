import type { CorrelationMetadata } from '@echidna-claw/contracts';
import { correlationMetadataSchema } from '@echidna-claw/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { bindRequestCorrelation } from '../../request-context.js';
import { isTelegramApprovalCallbackUpdate } from './approval-callbacks.js';
import type { TelegramWebhookUpdate } from '../../../services/channel/contracts.js';

const telegramWebhookBodySchema = z
  .object({
    callback_query: z.object({ data: z.string().trim().optional() }).passthrough().optional(),
    correlation: correlationMetadataSchema.optional(),
    message: z.object({}).passthrough().optional(),
    update_id: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export function registerTelegramWebhookRoutes(app: FastifyInstance): void {
  app.post('/webhook', async (request) => {
    const body = telegramWebhookBodySchema.parse(request.body) as TelegramWebhookUpdate & {
      correlation?: CorrelationMetadata;
    };

    if (body.correlation != null) {
      bindRequestCorrelation(request, { correlation: body.correlation });
    }

    if (isTelegramApprovalCallbackUpdate(body)) {
      await app.dependencies.services.approvalCallbackService.handleTelegramCallback(body);
      return { accepted: true, kind: 'approval_callback' };
    }

    await app.dependencies.services.telegramIngressService.handleWebhook(body);
    return { accepted: true, kind: 'webhook' };
  });
}

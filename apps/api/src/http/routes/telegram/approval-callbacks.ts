import { z } from 'zod';

import type {
  TelegramApprovalCallbackUpdate,
  TelegramWebhookUpdate,
} from '../../../services/channel/contracts.js';

const approvalCallbackSchema = z
  .object({
    callback_query: z
      .object({
        data: z.string().trim().min(1),
      })
      .passthrough(),
  })
  .passthrough();

export function isTelegramApprovalCallbackUpdate(
  update: TelegramWebhookUpdate,
): update is TelegramApprovalCallbackUpdate {
  return approvalCallbackSchema.safeParse(update).success;
}

import type { Logger } from '@echidna-claw/observability';

import type { TelegramTransportAdapter } from '../../adapters/telegram/index.js';
import type { ApprovalCallbackService, TelegramApprovalCallbackUpdate } from './contracts.js';

export function createApprovalCallbackService(options: {
  logger: Logger;
  telegramTransport: TelegramTransportAdapter;
}): ApprovalCallbackService {
  return {
    async handleTelegramCallback(update: TelegramApprovalCallbackUpdate): Promise<void> {
      options.logger.info('approval_callback.handle_telegram_callback', {
        callbackData: update.callback_query.data,
      });
      await options.telegramTransport.handleApprovalCallback(update);
    },
  };
}

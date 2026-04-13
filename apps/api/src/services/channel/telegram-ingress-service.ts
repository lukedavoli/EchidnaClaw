import type { Logger } from '@echidna-claw/observability';

import type { TelegramTransportAdapter } from '../../adapters/telegram/index.js';
import type { TelegramIngressService, TelegramWebhookUpdate } from './contracts.js';

export function createTelegramIngressService(options: {
  logger: Logger;
  telegramTransport: TelegramTransportAdapter;
}): TelegramIngressService {
  return {
    async handleWebhook(update: TelegramWebhookUpdate): Promise<void> {
      options.logger.info('telegram_ingress.handle_webhook', { updateId: update.update_id });
      await options.telegramTransport.handleWebhook(update);
    },
  };
}

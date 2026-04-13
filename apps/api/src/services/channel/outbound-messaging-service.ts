import type { Logger } from '@echidna-claw/observability';

import type { TelegramTransportAdapter } from '../../adapters/telegram/index.js';
import type { OutboundMessageRequest, OutboundMessagingService } from './contracts.js';

export function createOutboundMessagingService(options: {
  logger: Logger;
  telegramTransport: TelegramTransportAdapter;
}): OutboundMessagingService {
  return {
    async sendMessage(input: OutboundMessageRequest): Promise<void> {
      options.logger.info('outbound_messaging.send_message', {
        agentId: input.agentId,
        channelId: input.channelId,
      });
      await options.telegramTransport.sendMessage(input);
    },
  };
}

import { NotImplementedYetError } from '../../http/errors.js';
import type {
  OutboundMessageRequest,
  TelegramApprovalCallbackUpdate,
  TelegramWebhookUpdate,
} from '../../services/channel/contracts.js';

export interface TelegramTransportAdapter {
  handleApprovalCallback(update: TelegramApprovalCallbackUpdate): Promise<void>;
  handleWebhook(update: TelegramWebhookUpdate): Promise<void>;
  sendMessage(input: OutboundMessageRequest): Promise<void>;
}

export function createTelegramTransportAdapter(mode: 'stubbed' | 'configured-placeholder'): {
  adapter: TelegramTransportAdapter;
  health: {
    description: string;
    mode: 'stubbed' | 'configured-placeholder';
    ready: true;
  };
} {
  return {
    adapter: {
      async handleApprovalCallback(_update: TelegramApprovalCallbackUpdate): Promise<void> {
        throw new NotImplementedYetError(
          'Telegram approval callback handling is reserved for Step 9.',
        );
      },
      async handleWebhook(_update: TelegramWebhookUpdate): Promise<void> {
        throw new NotImplementedYetError('Telegram ingress is reserved for Step 9.');
      },
      async sendMessage(_input: OutboundMessageRequest): Promise<void> {
        throw new NotImplementedYetError('Telegram outbound delivery is reserved for Step 9.');
      },
    },
    health: {
      description:
        mode === 'stubbed'
          ? 'Telegram transport is stubbed for local-minimal startup.'
          : 'Telegram config is present; the adapter is reserved for Step 9.',
      mode,
      ready: true,
    },
  };
}

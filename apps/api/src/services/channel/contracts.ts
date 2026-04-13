import type { AgentId, ChannelId, CorrelationMetadata } from '@echidna-claw/contracts';

export type TelegramWebhookUpdate = {
  callback_query?: Record<string, unknown> & {
    data?: string;
  };
  message?: Record<string, unknown>;
  update_id?: number;
} & Record<string, unknown>;

export type TelegramApprovalCallbackUpdate = TelegramWebhookUpdate & {
  callback_query: Record<string, unknown> & {
    data: string;
  };
};

export type OutboundMessageRequest = {
  agentId: AgentId;
  channelId: ChannelId;
  correlation: CorrelationMetadata;
  text: string;
};

export interface TelegramIngressService {
  handleWebhook(update: TelegramWebhookUpdate): Promise<void>;
}

export interface OutboundMessagingService {
  sendMessage(input: OutboundMessageRequest): Promise<void>;
}

export interface ApprovalCallbackService {
  handleTelegramCallback(update: TelegramApprovalCallbackUpdate): Promise<void>;
}

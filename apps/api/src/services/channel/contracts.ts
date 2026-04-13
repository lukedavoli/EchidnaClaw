import type {
  ChannelActionResponse,
  ChannelId,
  OutboundMessage,
  SendChannelMessageRequest,
  TrustedChannelIngressDispatchRequest,
} from '@echidna-claw/contracts';

export type TelegramWebhookUser = {
  first_name?: string;
  id: number | string;
  is_bot?: boolean;
  last_name?: string;
  username?: string;
} & Record<string, unknown>;

export type TelegramWebhookChat = {
  first_name?: string;
  id: number | string;
  last_name?: string;
  title?: string;
  type: string;
  username?: string;
} & Record<string, unknown>;

export type TelegramWebhookMessage = {
  chat: TelegramWebhookChat;
  date?: number;
  from?: TelegramWebhookUser;
  message_id: number;
  text?: string;
} & Record<string, unknown>;

export type TelegramWebhookCallbackQuery = {
  data?: string;
  from: TelegramWebhookUser;
  id: string;
  message?: TelegramWebhookMessage;
} & Record<string, unknown>;

export type TelegramWebhookUpdate = {
  callback_query?: TelegramWebhookCallbackQuery;
  message?: TelegramWebhookMessage;
  update_id: number;
} & Record<string, unknown>;

export interface TelegramIngressService {
  handleWebhook(input: {
    channelId: ChannelId;
    update: TelegramWebhookUpdate;
  }): Promise<void>;
}

export interface OutboundMessagingService {
  sendMessage(input: SendChannelMessageRequest): Promise<OutboundMessage>;
}

export interface ApprovalCallbackService {
  handleActionResponse(input: ChannelActionResponse): Promise<void>;
}

export interface TrustedChannelIngressDispatcher {
  dispatchTrustedInboundMessage(input: TrustedChannelIngressDispatchRequest): Promise<void>;
}

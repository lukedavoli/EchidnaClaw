import type { InboundMessageKind, TelegramMessageSender } from '@echidna-claw/contracts';
import { buildTelegramDisplayName } from '@echidna-claw/domain';
import { z } from 'zod';

import type {
  TelegramWebhookCallbackQuery,
  TelegramWebhookMessage,
  TelegramWebhookUpdate,
  TelegramWebhookUser,
} from './contracts.js';

const telegramWebhookUserSchema = z
  .object({
    first_name: z.string().trim().optional(),
    id: z.union([z.number().int(), z.string().trim().min(1)]),
    is_bot: z.boolean().optional(),
    last_name: z.string().trim().optional(),
    username: z.string().trim().optional(),
  })
  .passthrough();

const telegramWebhookChatSchema = z
  .object({
    first_name: z.string().trim().optional(),
    id: z.union([z.number().int(), z.string().trim().min(1)]),
    last_name: z.string().trim().optional(),
    title: z.string().trim().optional(),
    type: z.string().trim().min(1),
    username: z.string().trim().optional(),
  })
  .passthrough();

const telegramWebhookMessageSchema = z
  .object({
    chat: telegramWebhookChatSchema,
    date: z.number().int().nonnegative().optional(),
    from: telegramWebhookUserSchema.optional(),
    message_id: z.number().int().nonnegative(),
    text: z.string().optional(),
  })
  .passthrough();

const telegramWebhookCallbackQuerySchema = z
  .object({
    data: z.string().trim().optional(),
    from: telegramWebhookUserSchema,
    id: z.string().trim().min(1),
    message: telegramWebhookMessageSchema.optional(),
  })
  .passthrough();

export const telegramWebhookUpdateSchema = z
  .object({
    callback_query: telegramWebhookCallbackQuerySchema.optional(),
    message: telegramWebhookMessageSchema.optional(),
    update_id: z.number().int().nonnegative(),
  })
  .passthrough()
  .refine((value) => value.message != null || value.callback_query != null, {
    message: 'Telegram updates must include a message or callback_query.',
  });

export type NormalizedTelegramUpdate = {
  callbackData?: string;
  callbackQueryId?: string;
  chatType: string;
  externalChatId?: string;
  externalMessageId?: string;
  externalUpdateId: string;
  kind: InboundMessageKind;
  sender?: TelegramMessageSender;
  senderIsBot: boolean;
  text: string;
  unsupportedType?: string;
};

function toSender(user: TelegramWebhookUser | undefined): {
  sender?: TelegramMessageSender;
  senderIsBot: boolean;
} {
  if (!user) {
    return {
      senderIsBot: false,
    };
  }

  const externalUserId = String(user.id).trim();
  const displayName = buildTelegramDisplayName({
    externalUserId,
    ...(user.first_name ? { firstName: user.first_name } : {}),
    ...(user.last_name ? { lastName: user.last_name } : {}),
    ...(user.username ? { username: user.username } : {}),
  });
  return {
    sender: {
      provider: 'telegram',
      externalUserId,
      ...(user.username?.trim()
        ? { externalUserHandle: user.username.replace(/^@+/, '').trim() }
        : {}),
      ...(displayName
        ? {
            displayName,
          }
        : {}),
    },
    senderIsBot: user.is_bot === true,
  };
}

function identifyUnsupportedMessageType(message: TelegramWebhookMessage): string {
  const unsupportedKey = [
    'animation',
    'audio',
    'contact',
    'document',
    'location',
    'photo',
    'poll',
    'sticker',
    'venue',
    'video',
    'video_note',
    'voice',
  ].find((key) => key in message);

  return unsupportedKey ? `message:${unsupportedKey}` : 'message:unsupported';
}

function normalizeMessageUpdate(message: TelegramWebhookMessage, updateId: number): NormalizedTelegramUpdate {
  const { sender, senderIsBot } = toSender(message.from);
  const text = message.text?.trim() ?? '';

  if (text.length > 0) {
    return {
      chatType: message.chat.type,
      externalChatId: String(message.chat.id),
      externalMessageId: String(message.message_id),
      externalUpdateId: String(updateId),
      kind: 'text',
      ...(sender ? { sender } : {}),
      senderIsBot,
      text,
    };
  }

  return {
    chatType: message.chat.type,
    externalChatId: String(message.chat.id),
    externalMessageId: String(message.message_id),
    externalUpdateId: String(updateId),
    kind: 'unsupported',
    ...(sender ? { sender } : {}),
    senderIsBot,
    text: '',
    unsupportedType: identifyUnsupportedMessageType(message),
  };
}

function normalizeCallbackUpdate(
  callbackQuery: TelegramWebhookCallbackQuery,
  updateId: number,
): NormalizedTelegramUpdate {
  const { sender, senderIsBot } = toSender(callbackQuery.from);
  const data = callbackQuery.data?.trim();

  if (!callbackQuery.message) {
    return {
      callbackQueryId: callbackQuery.id,
      chatType: 'unknown',
      externalUpdateId: String(updateId),
      kind: 'unsupported',
      ...(sender ? { sender } : {}),
      senderIsBot,
      text: '',
      unsupportedType: 'callback_query:missing_message',
    };
  }

  const externalChatId = String(callbackQuery.message.chat.id);
  const externalMessageId = String(callbackQuery.message.message_id);

  if (!data) {
    return {
      callbackQueryId: callbackQuery.id,
      chatType: callbackQuery.message.chat.type,
      externalChatId,
      externalMessageId,
      externalUpdateId: String(updateId),
      kind: 'unsupported',
      ...(sender ? { sender } : {}),
      senderIsBot,
      text: '',
      unsupportedType: 'callback_query:missing_data',
    };
  }

  return {
    callbackData: data,
    callbackQueryId: callbackQuery.id,
    chatType: callbackQuery.message.chat.type,
    externalChatId,
    externalMessageId,
    externalUpdateId: String(updateId),
    kind: 'callback_query',
    ...(sender ? { sender } : {}),
    senderIsBot,
    text: '',
  };
}

export function parseTelegramWebhookUpdate(input: unknown): TelegramWebhookUpdate {
  return telegramWebhookUpdateSchema.parse(input) as TelegramWebhookUpdate;
}

export function normalizeTelegramWebhookUpdate(update: TelegramWebhookUpdate): NormalizedTelegramUpdate {
  if (update.callback_query) {
    return normalizeCallbackUpdate(update.callback_query, update.update_id);
  }

  if (update.message) {
    return normalizeMessageUpdate(update.message, update.update_id);
  }

  return {
    chatType: 'unknown',
    externalUpdateId: String(update.update_id),
    kind: 'unsupported',
    senderIsBot: false,
    text: '',
    unsupportedType: 'update:unsupported',
  };
}

export type TelegramWebhookUserSchema = z.infer<typeof telegramWebhookUserSchema>;
export type TelegramWebhookChatSchema = z.infer<typeof telegramWebhookChatSchema>;
export type TelegramWebhookMessageSchema = z.infer<typeof telegramWebhookMessageSchema>;
export type TelegramWebhookCallbackQuerySchema = z.infer<typeof telegramWebhookCallbackQuerySchema>;

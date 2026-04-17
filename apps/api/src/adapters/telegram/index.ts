import type { OutboundMessageAction } from '@echidna-claw/contracts';
import { encodeTelegramCallbackData } from '@echidna-claw/domain';

import type { ApiRuntimeConfig } from '../../config/api-runtime-config.js';

type TelegramApiEnvelope<TResult> = {
  ok: boolean;
  description?: string;
  result?: TResult;
};

type TelegramSendMessageResult = {
  message_id: number;
};

type TelegramGetMeResult = {
  first_name?: string;
  id: number | string;
  username?: string;
};

export type TelegramBotIdentity = {
  botUserId: string;
  displayName: string | null;
  username: string | null;
};

export class TelegramBotApiError extends Error {
  constructor(
    message: string,
    readonly details: {
      failureCode: string;
      retryable: boolean;
      statusCode?: number;
    },
  ) {
    super(message);
    this.name = 'TelegramBotApiError';
  }
}

export interface TelegramBotApiAdapter {
  answerCallbackQuery(input: {
    botToken: string;
    callbackQueryId: string;
    text?: string;
  }): Promise<void>;
  getMe(input: { botToken: string }): Promise<TelegramBotIdentity>;
  sendMessage(input: {
    botToken: string;
    chatId: string;
    text: string;
    actions?: OutboundMessageAction[];
  }): Promise<{ externalMessageId: string }>;
  setWebhook(input: {
    botToken: string;
    webhookUrl: string;
    secretToken: string;
  }): Promise<void>;
}

function mapTelegramFailure(statusCode: number | undefined): {
  failureCode: string;
  retryable: boolean;
} {
  if (statusCode === 400) {
    return {
      failureCode: 'telegram_bad_request',
      retryable: false,
    };
  }

  if (statusCode === 403 || statusCode === 404) {
    return {
      failureCode: 'telegram_forbidden',
      retryable: false,
    };
  }

  if (statusCode === 429) {
    return {
      failureCode: 'telegram_rate_limited',
      retryable: true,
    };
  }

  if (statusCode != null && statusCode >= 500) {
    return {
      failureCode: 'telegram_server_error',
      retryable: true,
    };
  }

  return {
    failureCode: 'telegram_request_failed',
    retryable: false,
  };
}

function chunkActions(actions: OutboundMessageAction[]): Array<Array<OutboundMessageAction>> {
  const rows: Array<Array<OutboundMessageAction>> = [];

  for (let index = 0; index < actions.length; index += 2) {
    rows.push(actions.slice(index, index + 2));
  }

  return rows;
}

function buildReplyMarkup(actions: OutboundMessageAction[] | undefined): Record<string, unknown> | undefined {
  if (!actions || actions.length === 0) {
    return undefined;
  }

  return {
    inline_keyboard: chunkActions(actions).map((row) =>
      row.map((action) => ({
        text: action.label,
        callback_data: encodeTelegramCallbackData(action),
      })),
    ),
  };
}

async function readTelegramEnvelope<TResult>(
  response: Response,
): Promise<TelegramApiEnvelope<TResult>> {
  const raw = await response.text();

  if (raw.trim().length === 0) {
    return {
      ok: response.ok,
    };
  }

  try {
    return JSON.parse(raw) as TelegramApiEnvelope<TResult>;
  } catch {
    return {
      ok: response.ok,
      description: raw,
    };
  }
}

export function createTelegramTransportAdapter(config: Pick<ApiRuntimeConfig, 'telegram'>): {
  adapter: TelegramBotApiAdapter;
  health: {
    description: string;
    mode: 'configured_live';
    ready: true;
  };
} {
  async function post<TResult>(
    botToken: string,
    method: string,
    payload: Record<string, unknown>,
  ): Promise<TResult> {
    const endpoint = `${config.telegram.apiBaseUrl.replace(/\/+$/, '')}/bot${botToken}/${method}`;

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(config.telegram.requestTimeoutMs),
      });
    } catch (error) {
      const failureCode =
        error instanceof Error && error.name === 'TimeoutError'
          ? 'telegram_timeout'
          : 'telegram_network_error';

      throw new TelegramBotApiError('Telegram Bot API request failed before a response was received.', {
        failureCode,
        retryable: true,
      });
    }

    const envelope = await readTelegramEnvelope<TResult>(response);
    if (!response.ok || envelope.ok !== true || envelope.result == null) {
      const failure = mapTelegramFailure(response.status);
      throw new TelegramBotApiError(
        envelope.description ??
          `Telegram Bot API request failed with HTTP ${response.status}.`,
        {
          ...failure,
          statusCode: response.status,
        },
      );
    }

    return envelope.result;
  }

  return {
    adapter: {
      async answerCallbackQuery(input): Promise<void> {
        await post<boolean>(input.botToken, 'answerCallbackQuery', {
          callback_query_id: input.callbackQueryId,
          ...(input.text ? { text: input.text } : {}),
          show_alert: false,
        });
      },
      async getMe(input): Promise<TelegramBotIdentity> {
        const result = await post<TelegramGetMeResult>(input.botToken, 'getMe', {});
        const username = result.username?.replace(/^@+/, '').trim() ?? '';

        return {
          botUserId: String(result.id).trim(),
          displayName: result.first_name?.trim() || null,
          username: username.length > 0 ? username : null,
        };
      },
      async sendMessage(input): Promise<{ externalMessageId: string }> {
        const result = await post<TelegramSendMessageResult>(input.botToken, 'sendMessage', {
          chat_id: input.chatId,
          text: input.text,
          ...(input.actions && input.actions.length > 0
            ? { reply_markup: buildReplyMarkup(input.actions) }
            : {}),
        });

        return {
          externalMessageId: String(result.message_id),
        };
      },
      async setWebhook(input): Promise<void> {
        await post<boolean>(input.botToken, 'setWebhook', {
          secret_token: input.secretToken,
          url: input.webhookUrl,
        });
      },
    },
    health: {
      description: 'Telegram Bot API adapter is configured for live outbound requests.',
      mode: 'configured_live',
      ready: true,
    },
  };
}

import type { FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../config/api-runtime-config.js';
import { AuthenticationError } from './errors.js';

export const INTERNAL_RUNTIME_AUTH_HEADER = 'x-echidna-internal-token';
export const TELEGRAM_WEBHOOK_SECRET_HEADER = 'x-telegram-bot-api-secret-token';

function readHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export function assertTelegramWebhookAuthorized(
  request: FastifyRequest,
  config: ApiRuntimeConfig,
): void {
  const providedToken = readHeader(request, TELEGRAM_WEBHOOK_SECRET_HEADER);

  if (providedToken !== config.telegram.webhookSecretToken) {
    throw new AuthenticationError('Telegram webhook token is missing or invalid.');
  }
}

export function assertInternalRuntimeAuthorized(
  request: FastifyRequest,
  config: ApiRuntimeConfig,
): void {
  const providedToken = readHeader(request, INTERNAL_RUNTIME_AUTH_HEADER);

  if (providedToken !== config.internalRuntime.authToken) {
    throw new AuthenticationError('Internal runtime token is missing or invalid.');
  }
}

import type { z } from 'zod';

import { ApiClientError, normalizeApiError, normalizeFetchError } from './errors.js';

type HttpRequestOptions<TSchema extends z.ZodTypeAny> = {
  acceptableStatusCodes?: number[];
  body?: unknown;
  method?: 'GET' | 'POST';
  path: string;
  schema: TSchema;
};

type CreateHttpClientOptions = {
  baseUrl: string;
  fetchImplementation?: typeof fetch;
};

export function createHttpClient({
  baseUrl,
  fetchImplementation,
}: CreateHttpClientOptions) {
  async function request<TSchema extends z.ZodTypeAny>({
    acceptableStatusCodes = [200],
    body,
    method = 'GET',
    path,
    schema,
  }: HttpRequestOptions<TSchema>): Promise<z.infer<TSchema>> {
    const requestUrl = new URL(path, baseUrl).toString();

    try {
      const fetcher = fetchImplementation ?? globalThis.fetch;
      const init: RequestInit = {
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        method,
      };

      if (body !== undefined) {
        init.body = JSON.stringify(body);
      }

      const response = await fetcher(requestUrl, {
        ...init,
      });

      if (!acceptableStatusCodes.includes(response.status)) {
        throw await normalizeApiError(response);
      }

      const payload = (await response.json()) as unknown;

      return schema.parse(payload);
    } catch (error) {
      throw error instanceof ApiClientError ? error : normalizeFetchError(error);
    }
  }

  return {
    request,
  };
}

import { errorResponseSchema } from '@echidna-claw/contracts';
import { ZodError } from 'zod';

type ApiClientErrorKind = 'api' | 'invalid_response' | 'network';

type ApiClientErrorOptions = {
  cause?: unknown;
  code: string;
  kind: ApiClientErrorKind;
  message: string;
  retryable?: boolean;
  status?: number;
  traceId?: string;
};

export class ApiClientError extends Error {
  readonly code: string;
  readonly kind: ApiClientErrorKind;
  readonly retryable: boolean;
  readonly status: number | null;
  readonly traceId: string | null;

  constructor(options: ApiClientErrorOptions) {
    super(options.message, { cause: options.cause });
    this.code = options.code;
    this.kind = options.kind;
    this.name = 'ApiClientError';
    this.retryable = options.retryable ?? false;
    this.status = options.status ?? null;
    this.traceId = options.traceId ?? null;
  }
}

async function readJson(response: Response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function normalizeApiError(response: Response) {
  const payload = await readJson(response);
  const parsed = errorResponseSchema.safeParse(payload);

  if (parsed.success) {
    return new ApiClientError({
      code: parsed.data.error.code,
      kind: 'api',
      message: parsed.data.error.message,
      retryable: parsed.data.error.retryable,
      status: response.status,
      traceId: parsed.data.error.traceId,
    });
  }

  const traceId = response.headers.get('x-trace-id');

  return new ApiClientError({
    code: 'http_error',
    kind: 'api',
    message: `The API returned HTTP ${response.status}.`,
    retryable: response.status >= 500,
    status: response.status,
    ...(traceId ? { traceId } : {}),
  });
}

export function normalizeFetchError(error: unknown) {
  if (error instanceof ApiClientError) {
    return error;
  }

  if (error instanceof ZodError) {
    return new ApiClientError({
      cause: error,
      code: 'invalid_response',
      kind: 'invalid_response',
      message: 'The API returned a response that did not match the expected contract.',
    });
  }

  if (error instanceof Error) {
    return new ApiClientError({
      cause: error,
      code: 'network_unavailable',
      kind: 'network',
      message: 'The control plane could not reach the API.',
      retryable: true,
    });
  }

  return new ApiClientError({
    code: 'unexpected_error',
    kind: 'network',
    message: 'The control plane hit an unexpected transport error.',
    retryable: true,
  });
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

export function isReservedApiError(error: unknown) {
  return isApiClientError(error) && error.status === 501;
}

export function isDependencyUnavailableError(error: unknown) {
  return isApiClientError(error) && error.status === 503;
}

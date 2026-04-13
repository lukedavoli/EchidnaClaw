import { ZodError } from 'zod';

import type { ErrorResponse } from './response-contract.js';

export class HttpError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly statusCode: number;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: {
      cause?: unknown;
      retryable?: boolean;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.code = code;
    this.name = this.constructor.name;
    this.retryable = options.retryable ?? false;
    this.statusCode = statusCode;
  }
}

export class AuthenticationError extends HttpError {
  constructor(message = 'Authentication failed.') {
    super(401, 'authentication_failed', message);
  }
}

export class AuthorizationError extends HttpError {
  constructor(message = 'The caller is not allowed to perform this action.') {
    super(403, 'authorization_failed', message);
  }
}

export class ConflictError extends HttpError {
  constructor(message = 'The requested operation conflicts with the current resource state.') {
    super(409, 'state_conflict', message);
  }
}

export class DependencyUnavailableError extends HttpError {
  constructor(message = 'A required dependency is unavailable.', options: { cause?: unknown } = {}) {
    super(503, 'dependency_unavailable', message, { ...options, retryable: true });
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'The requested resource was not found.') {
    super(404, 'not_found', message);
  }
}

export class NotImplementedYetError extends HttpError {
  constructor(message = 'This route is reserved for a later implementation step.') {
    super(501, 'not_implemented_yet', message);
  }
}

export class ValidationError extends HttpError {
  constructor(message = 'The request payload is invalid.', options: { cause?: unknown } = {}) {
    super(400, 'validation_failed', message, options);
  }
}

export function normalizeHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }

  if (error instanceof ZodError) {
    const issueSummary = error.issues
      .map((issue) => {
        const path = issue.path.length === 0 ? 'request' : issue.path.join('.');
        return `${path}: ${issue.message}`;
      })
      .join('; ');

    return new ValidationError(`The request payload is invalid. ${issueSummary}`.trim(), {
      cause: error,
    });
  }

  return new HttpError(500, 'internal_error', 'The API request failed unexpectedly.', {
    cause: error,
    retryable: false,
  });
}

export function toErrorResponse(error: unknown, traceId: string): {
  body: ErrorResponse;
  statusCode: number;
} {
  const normalized = normalizeHttpError(error);

  return {
    body: {
      error: {
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable,
        traceId,
      },
    },
    statusCode: normalized.statusCode,
  };
}

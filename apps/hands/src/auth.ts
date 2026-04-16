import type { FastifyRequest } from 'fastify';

export const INTERNAL_RUNTIME_AUTH_HEADER = 'x-echidna-internal-token';

function readHeader(request: FastifyRequest, headerName: string): string | null {
  const value = request.headers[headerName];
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }

  return null;
}

export function assertInternalRuntimeAuthorized(
  request: FastifyRequest,
  expectedToken: string,
): void {
  const providedToken = readHeader(request, INTERNAL_RUNTIME_AUTH_HEADER);
  if (providedToken !== expectedToken) {
    throw new Error('Unauthorized internal runtime request.');
  }
}

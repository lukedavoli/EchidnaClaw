import type { SandboxConfig } from '@echidna-claw/config';
import type { FastifyRequest } from 'fastify';

import { SandboxAuthenticationError } from './errors.js';

export const INTERNAL_RUNTIME_AUTH_HEADER = 'x-echidna-internal-token';

function readHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export function assertSandboxAuthorized(request: FastifyRequest, config: SandboxConfig): void {
  const providedToken = readHeader(request, INTERNAL_RUNTIME_AUTH_HEADER);

  if (providedToken !== config.internalAuthToken) {
    throw new SandboxAuthenticationError();
  }
}

import {
  sandboxCloseSessionRequestSchema,
  sandboxExecuteCommandRequestSchema,
  sandboxExecuteCommandResultSchema,
  sandboxProvisionSessionRequestSchema,
  sandboxSessionSchema,
  type SandboxCloseSessionRequest,
  type SandboxExecuteCommandRequest,
  type SandboxExecuteCommandResult,
  type SandboxProvisionSessionRequest,
  type SandboxSession,
} from '@echidna-claw/contracts';

import type { ApiRuntimeConfig } from '../../config/api-runtime-config.js';
import {
  ConflictError,
  DependencyUnavailableError,
  NotFoundError,
  ValidationError,
} from '../../http/errors.js';
import { INTERNAL_RUNTIME_AUTH_HEADER } from '../../http/protection.js';

export interface SandboxRuntimeAdapter {
  createSession(input: SandboxProvisionSessionRequest): Promise<SandboxSession>;
  executeCommand(input: SandboxExecuteCommandRequest): Promise<SandboxExecuteCommandResult>;
  getSession(sessionId: string): Promise<SandboxSession>;
  closeSession(input: SandboxCloseSessionRequest): Promise<SandboxSession>;
}

async function readSandboxError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: {
        message?: string;
      };
    };
    return payload.error?.message ?? `Sandbox runtime returned HTTP ${response.status}.`;
  } catch {
    return `Sandbox runtime returned HTTP ${response.status}.`;
  }
}

async function assertOk(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }

  const message = await readSandboxError(response);
  switch (response.status) {
    case 400:
      throw new ValidationError(message);
    case 404:
      throw new NotFoundError(message);
    case 409:
      throw new ConflictError(message);
    default:
      throw new DependencyUnavailableError(message);
  }
}

function createSandboxUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl.replace(/\/$/, '')}/`).toString();
}

export function createSandboxRuntimeAdapter(config: ApiRuntimeConfig): {
  adapter: SandboxRuntimeAdapter;
  health: {
    description: string;
    mode: 'configured_live';
    ready: true;
  };
} {
  async function callSandbox(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(createSandboxUrl(config.sandbox.baseUrl, path), {
        ...init,
        headers: {
          'content-type': 'application/json',
          [INTERNAL_RUNTIME_AUTH_HEADER]: config.internalRuntime.authToken,
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      throw new DependencyUnavailableError('Sandbox runtime is unavailable.', {
        cause: error,
      });
    }
  }

  return {
    adapter: {
      async createSession(input: SandboxProvisionSessionRequest): Promise<SandboxSession> {
        const request = sandboxProvisionSessionRequestSchema.parse(input);
        const response = await callSandbox('/internal/sessions', {
          body: JSON.stringify(request),
          method: 'POST',
        });
        await assertOk(response);
        return sandboxSessionSchema.parse(await response.json());
      },

      async executeCommand(
        input: SandboxExecuteCommandRequest,
      ): Promise<SandboxExecuteCommandResult> {
        const request = sandboxExecuteCommandRequestSchema.parse(input);
        const response = await callSandbox(`/internal/sessions/${request.sessionId}/commands`, {
          body: JSON.stringify(request),
          method: 'POST',
        });
        await assertOk(response);
        return sandboxExecuteCommandResultSchema.parse(await response.json());
      },

      async getSession(sessionId: string): Promise<SandboxSession> {
        const response = await callSandbox(`/internal/sessions/${sessionId}`, {
          method: 'GET',
        });
        await assertOk(response);
        return sandboxSessionSchema.parse(await response.json());
      },

      async closeSession(input: SandboxCloseSessionRequest): Promise<SandboxSession> {
        const request = sandboxCloseSessionRequestSchema.parse(input);
        const response = await callSandbox(`/internal/sessions/${request.sessionId}/close`, {
          body: JSON.stringify(request),
          method: 'POST',
        });
        await assertOk(response);
        return sandboxSessionSchema.parse(await response.json());
      },
    },
    health: {
      description: 'Sandbox runtime uses the dedicated internal HTTP execution service.',
      mode: 'configured_live',
      ready: true,
    },
  };
}

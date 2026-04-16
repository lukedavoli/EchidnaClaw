import type {
  RepositoryConfig,
  SandboxCloseSessionRequest,
  SandboxCreateSessionRequest,
  SandboxExecuteCommandRequest,
  SandboxExecuteCommandResult,
  SandboxService,
  SandboxSession,
} from '@echidna-claw/contracts';
import {
  createDeterministicSandboxSessionId,
  resolveSandboxPackageAllowlist,
  resolveSandboxPolicy,
} from '@echidna-claw/domain';
import type { Logger } from '@echidna-claw/observability';

import type { SandboxRuntimeAdapter } from '../../adapters/sandbox/index.js';
import type { RepositoryBundle } from '../../adapters/repositories/index.js';
import { ConflictError, NotFoundError } from '../../http/errors.js';

export function createSandboxRuntimeService(options: {
  logger: Logger;
  repositories: RepositoryBundle;
  repositoryConfig: RepositoryConfig;
  sandboxRuntime: SandboxRuntimeAdapter;
}): SandboxService {
  async function requireStoredSession(sessionId: string) {
    const storedSession = await options.repositories.execution.findSandboxSession(sessionId);
    if (!storedSession) {
      throw new NotFoundError(`Sandbox session '${sessionId}' was not found.`);
    }

    return storedSession;
  }

  return {
    async createSession(input: SandboxCreateSessionRequest): Promise<SandboxSession> {
      resolveSandboxPolicy(options.repositoryConfig, input.policyName);
      const packageAllowlistName =
        input.packageAllowlistName ?? options.repositoryConfig.sandbox.defaultPackageAllowlist;
      resolveSandboxPackageAllowlist(options.repositoryConfig, packageAllowlistName);

      const storedHandsRun = await options.repositories.execution.getHandsRun(
        input.agentId,
        input.handsRunId,
      );
      if (!storedHandsRun) {
        throw new NotFoundError(`Hands run '${input.handsRunId}' was not found.`);
      }

      if (storedHandsRun.value.taskId !== input.taskId) {
        throw new ConflictError('The sandbox request task does not match the Hands run task.');
      }

      const sessionId = createDeterministicSandboxSessionId(
        input.agentId,
        input.handsRunId,
        input.policyName,
      );
      const existingSession = await options.repositories.execution.getSandboxSession(
        input.agentId,
        sessionId,
      );
      if (existingSession) {
        return existingSession.value;
      }

      options.logger.info('sandbox_runtime.create_session', {
        handsRunId: input.handsRunId,
        sandboxSessionId: sessionId,
        taskId: input.taskId,
      });

      const provisionedSession = await options.sandboxRuntime.createSession({
        ...input,
        packageAllowlistName,
        sessionId,
      });
      const storedSession = await options.repositories.execution.createSandboxSession(
        provisionedSession,
      );

      return storedSession.value;
    },

    async executeCommand(
      input: SandboxExecuteCommandRequest,
    ): Promise<SandboxExecuteCommandResult> {
      const storedSession = await requireStoredSession(input.sessionId);
      const result = await options.sandboxRuntime.executeCommand(input);

      const updatedSession: SandboxSession = {
        ...storedSession.value,
        commandCount:
          storedSession.value.commandCount + (result.status === 'policy_denied' ? 0 : 1),
        failureCode: result.failureCode ?? null,
        lastCommandStartedAt:
          result.status === 'policy_denied'
            ? storedSession.value.lastCommandStartedAt
            : result.startedAt,
        lastCommandCompletedAt:
          result.status === 'policy_denied'
            ? storedSession.value.lastCommandCompletedAt
            : result.completedAt,
        state:
          storedSession.value.state === 'completed' || storedSession.value.state === 'cancelled'
            ? storedSession.value.state
            : 'created',
        updatedAt: result.completedAt,
        workingDirectory: result.resolvedWorkingDirectory,
      };
      await options.repositories.execution.replaceSandboxSession(updatedSession, storedSession.etag);

      return result;
    },

    async getSession(sessionId: string): Promise<SandboxSession> {
      return (await requireStoredSession(sessionId)).value;
    },

    async closeSession(input: SandboxCloseSessionRequest): Promise<SandboxSession> {
      const storedSession = await requireStoredSession(input.sessionId);
      const closedSession = await options.sandboxRuntime.closeSession(input);
      const replaced = await options.repositories.execution.replaceSandboxSession(
        {
          ...storedSession.value,
          ...closedSession,
        },
        storedSession.etag,
      );

      return replaced.value;
    },
  };
}

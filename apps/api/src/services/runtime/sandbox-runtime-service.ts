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
import { clipPreview, type Logger } from '@echidna-claw/observability';

import type { SandboxRuntimeAdapter } from '../../adapters/sandbox/index.js';
import type { RepositoryBundle } from '../../adapters/repositories/index.js';
import { ConflictError, NotFoundError } from '../../http/errors.js';
import type { CredentialLifecycleService } from './credential-lifecycle-service.js';
import type { AuditHistoryService } from './audit-history-service.js';

export function createSandboxRuntimeService(options: {
  auditHistoryService: AuditHistoryService;
  credentialLifecycleService: CredentialLifecycleService;
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

      const credentialBindings =
        input.credentialBindings.length > 0
          ? input.credentialBindings
          : await options.credentialLifecycleService.resolveSandboxBindings({
              agentId: input.agentId,
              credentialAliases: input.credentialAliases,
            });

      const provisionedSession = await options.sandboxRuntime.createSession({
        ...input,
        credentialBindings,
        packageAllowlistName,
        sessionId,
      });
      const storedSession = await options.repositories.execution.createSandboxSession(
        provisionedSession,
      );

      await options.auditHistoryService.append({
        action: 'sandbox.session.created',
        agentId: input.agentId,
        attributes: {
          handsRunId: input.handsRunId,
          packageAllowlistName,
          policyName: input.policyName,
          sessionId: provisionedSession.id,
          taskId: input.taskId,
        },
        category: 'sandbox_command',
        correlation: {
          ...input.correlation,
          handsRunId: input.handsRunId,
          sandboxSessionId: provisionedSession.id,
          taskId: input.taskId,
        },
        occurredAt: provisionedSession.createdAt,
        outcome: 'succeeded',
        summary: `Created sandbox session '${provisionedSession.id}'.`,
      });

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

      await options.auditHistoryService.append({
        action: result.status === 'policy_denied' ? 'sandbox.command.denied' : 'sandbox.command.completed',
        agentId: storedSession.value.agentId,
        artifactIds: result.artifactIds,
        attributes: {
          command: clipPreview(input.command, 120),
          durationMs: result.durationMs,
          exitCode: result.exitCode,
          failureCode: result.failureCode ?? null,
          outputTruncated: result.outputTruncated,
          sessionId: input.sessionId,
          shell: input.shell,
          status: result.status,
          workingDirectory: result.resolvedWorkingDirectory,
        },
        category: 'sandbox_command',
        correlation: {
          ...input.correlation,
          handsRunId: storedSession.value.handsRunId,
          sandboxSessionId: input.sessionId,
          taskId: storedSession.value.taskId,
        },
        occurredAt: result.completedAt,
        outcome:
          result.status === 'completed'
            ? 'succeeded'
            : result.status === 'policy_denied'
              ? 'denied'
              : result.status === 'cancelled'
                ? 'cancelled'
                : 'failed',
        summary:
          result.status === 'policy_denied'
            ? `Sandbox command denied for session '${input.sessionId}'.`
            : `Sandbox command ${result.status} for session '${input.sessionId}'.`,
      });

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

      await options.auditHistoryService.append({
        action: 'sandbox.session.closed',
        agentId: replaced.value.agentId,
        attributes: {
          reason: input.reason,
          sessionId: replaced.value.id,
          state: replaced.value.state,
        },
        category: 'sandbox_command',
        correlation: {
          ...input.correlation,
          handsRunId: replaced.value.handsRunId,
          sandboxSessionId: replaced.value.id,
          taskId: replaced.value.taskId,
        },
        occurredAt: replaced.value.updatedAt,
        outcome: input.reason === 'cancelled' ? 'cancelled' : 'succeeded',
        summary: `Closed sandbox session '${replaced.value.id}' with reason '${input.reason}'.`,
      });

      return replaced.value;
    },
  };
}

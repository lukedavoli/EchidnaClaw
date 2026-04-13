import type { SandboxCreateSessionRequest, SandboxService, SandboxSession } from '@echidna-claw/contracts';
import type { Logger } from '@echidna-claw/observability';

import type { SandboxRuntimeAdapter } from '../../adapters/jobs/index.js';
import { NotImplementedYetError } from '../../http/errors.js';

export function createSandboxRuntimeService(options: {
  logger: Logger;
  sandboxRuntime: SandboxRuntimeAdapter;
}): SandboxService {
  return {
    async closeSession(sessionId: string): Promise<SandboxSession> {
      void sessionId;
      throw new NotImplementedYetError('Sandbox session closure is reserved for Step 14.');
    },
    async createSession(input: SandboxCreateSessionRequest): Promise<SandboxSession> {
      options.logger.info('sandbox_runtime.create_session', {
        handsRunId: input.handsRunId,
        taskId: input.taskId,
      });
      return options.sandboxRuntime.createSession(input);
    },
  };
}

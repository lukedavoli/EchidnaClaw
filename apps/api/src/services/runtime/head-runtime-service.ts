import type {
  HeadService,
  HeadStartTurnRequest,
  HeadSupersedeTurnRequest,
  HeadTurn,
  OutboundMessage,
  Task,
} from '@echidna-claw/contracts';
import type { Logger } from '@echidna-claw/observability';

import type { HeadRuntimeAdapter } from '../../adapters/foundry/index.js';
import { NotImplementedYetError } from '../../http/errors.js';

export function createHeadRuntimeService(options: {
  headRuntime: HeadRuntimeAdapter;
  logger: Logger;
}): HeadService {
  return {
    async createTask(_task: Task): Promise<Task> {
      throw new NotImplementedYetError('Head task creation is reserved for Step 12.');
    },
    async sendMessage(_message: OutboundMessage): Promise<OutboundMessage> {
      throw new NotImplementedYetError('Head outbound messaging is reserved for Step 9.');
    },
    async startTurn(input: HeadStartTurnRequest): Promise<HeadTurn> {
      options.logger.info('head_runtime.start_turn', {
        agentId: input.agentId,
        workingContextId: input.workingContextId,
      });
      return options.headRuntime.startTurn(input);
    },
    async supersedeTurn(input: HeadSupersedeTurnRequest): Promise<HeadTurn> {
      options.logger.info('head_runtime.supersede_turn', { headTurnId: input.headTurnId });
      return options.headRuntime.supersedeTurn(input);
    },
  };
}

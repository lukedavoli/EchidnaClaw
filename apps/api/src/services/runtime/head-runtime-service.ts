import type {
  HeadService,
  HeadStartTurnRequest,
  HeadSupersedeTurnRequest,
  HeadTurn,
  SendChannelMessageRequest,
  Task,
} from '@echidna-claw/contracts';
import type { Logger } from '@echidna-claw/observability';

import type { HeadRuntimeAdapter } from '../../adapters/foundry/index.js';
import type { OutboundMessagingService } from '../channel/contracts.js';
import { NotImplementedYetError } from '../../http/errors.js';

export function createHeadRuntimeService(options: {
  headRuntime: HeadRuntimeAdapter;
  logger: Logger;
  outboundMessagingService: OutboundMessagingService;
}): HeadService {
  return {
    async createTask(task: Task): Promise<Task> {
      void task;
      throw new NotImplementedYetError('Head task creation is reserved for Step 12.');
    },
    async sendMessage(message: SendChannelMessageRequest) {
      options.logger.info('head_runtime.send_message', {
        agentId: message.agentId,
        channelId: message.channelId,
      });
      return options.outboundMessagingService.sendMessage(message);
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

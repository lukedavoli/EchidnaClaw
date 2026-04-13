import type { Logger } from '@echidna-claw/observability';

import type {
  ApprovalCallbackService,
  TrustedChannelIngressDispatcher,
} from './contracts.js';
import type {
  ChannelActionResponse,
  TrustedChannelIngressDispatchRequest,
} from '@echidna-claw/contracts';

export function createTrustedChannelIngressDispatcher(options: {
  logger: Logger;
}): TrustedChannelIngressDispatcher {
  return {
    async dispatchTrustedInboundMessage(
      input: TrustedChannelIngressDispatchRequest,
    ): Promise<void> {
      options.logger.info('trusted_channel_ingress.dispatch', {
        agentId: input.agentId,
        channelId: input.channelId,
        inboundMessageId: input.inboundMessageId,
        readThroughMessageSequence: input.readThroughMessageSequence,
      });
    },
  };
}

export function createApprovalActionDispatcher(options: {
  logger: Logger;
}): ApprovalCallbackService {
  return {
    async handleActionResponse(input: ChannelActionResponse): Promise<void> {
      switch (input.kind) {
        case 'approval_decision':
          options.logger.info('approval_action.dispatch', {
            agentId: input.agentId,
            approvalId: input.approvalId,
            channelId: input.channelId,
            decision: input.decision,
            inboundMessageId: input.inboundMessageId,
          });
          return;
        default:
          options.logger.warn('approval_action.unsupported', {
            channelId: input.channelId,
            kind: (input as { kind?: string }).kind ?? 'unknown',
          });
      }
    },
  };
}

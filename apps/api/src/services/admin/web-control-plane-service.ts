import type {
  ApprovalId,
  WebControlPlaneService,
  WebCreateAgentRequest,
  WebRestoreAgentRequest,
  WebSoftDeleteAgentRequest,
} from '@echidna-claw/contracts';
import type { Logger } from '@echidna-claw/observability';

import type { RepositoryBundle } from '../../adapters/repositories/index.js';

export function createWebControlPlaneService(options: {
  logger: Logger;
  repositories: RepositoryBundle;
}): WebControlPlaneService {
  return {
    async createAgent(input: WebCreateAgentRequest) {
      options.logger.info('web_control_plane.create_agent', { agentName: input.name });
      return options.repositories.agents.create(input);
    },
    async getAnalyticsOverview() {
      options.logger.info('web_control_plane.get_analytics_overview');
      return options.repositories.analytics.getOverview();
    },
    async getApprovalState(approvalId: ApprovalId) {
      options.logger.info('web_control_plane.get_approval_state', { approvalId });
      return options.repositories.approvals.getState(approvalId);
    },
    async listAgents() {
      options.logger.info('web_control_plane.list_agents');
      return options.repositories.agents.list();
    },
    async restoreAgent(input: WebRestoreAgentRequest) {
      options.logger.info('web_control_plane.restore_agent', { agentId: input.agentId });
      return options.repositories.agents.restore(input);
    },
    async softDeleteAgent(input: WebSoftDeleteAgentRequest) {
      options.logger.info('web_control_plane.soft_delete_agent', { agentId: input.agentId });
      return options.repositories.agents.softDelete(input);
    },
  };
}

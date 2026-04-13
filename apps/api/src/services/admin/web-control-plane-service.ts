import type {
  ApprovalId,
  RepositoryConfig,
  WebControlPlaneService,
} from '@echidna-claw/contracts';
import type { Logger } from '@echidna-claw/observability';

import type { RepositoryBundle } from '../../adapters/repositories/index.js';
import { createAgentRegistryService } from './agent-registry-service.js';

export function createWebControlPlaneService(options: {
  logger: Logger;
  repositories: RepositoryBundle;
  repositoryConfig: RepositoryConfig;
}): WebControlPlaneService {
  const agentRegistry = createAgentRegistryService({
    logger: options.logger,
    repositories: options.repositories,
    repositoryConfig: options.repositoryConfig,
  });

  return {
    async createAgent(input) {
      options.logger.info('web_control_plane.create_agent', { agentName: input.name });
      return agentRegistry.createAgent(input);
    },
    async getAnalyticsOverview() {
      options.logger.info('web_control_plane.get_analytics_overview');
      return options.repositories.analytics.getOverview();
    },
    async getAgent(agentId) {
      options.logger.info('web_control_plane.get_agent', { agentId });
      return agentRegistry.getAgent(agentId);
    },
    async getApprovalState(approvalId: ApprovalId) {
      options.logger.info('web_control_plane.get_approval_state', { approvalId });
      return options.repositories.approvals.getState(approvalId);
    },
    async listAgents() {
      options.logger.info('web_control_plane.list_agents');
      return agentRegistry.listAgents();
    },
    async retryAgentProvisioning(input) {
      options.logger.info('web_control_plane.retry_agent_provisioning', { agentId: input.agentId });
      return agentRegistry.retryAgentProvisioning(input);
    },
    async restoreAgent(input) {
      options.logger.info('web_control_plane.restore_agent', { agentId: input.agentId });
      return agentRegistry.restoreAgent(input);
    },
    async softDeleteAgent(input) {
      options.logger.info('web_control_plane.soft_delete_agent', { agentId: input.agentId });
      return agentRegistry.softDeleteAgent(input);
    },
    async completeAgentProvisioning(input) {
      options.logger.info('web_control_plane.complete_agent_provisioning', { agentId: input.agentId });
      return agentRegistry.completeAgentProvisioning(input);
    },
    async recordAgentProvisioningFailure(input) {
      options.logger.info('web_control_plane.record_agent_provisioning_failure', {
        agentId: input.agentId,
      });
      return agentRegistry.recordAgentProvisioningFailure(input);
    },
  };
}

import type {
  ApprovalId,
  RepositoryConfig,
  WebControlPlaneService,
} from '@echidna-claw/contracts';
import type { Logger } from '@echidna-claw/observability';

import type { RepositoryBundle } from '../../adapters/repositories/index.js';
import { NotFoundError } from '../../http/errors.js';
import { createAgentRegistryService } from './agent-registry-service.js';
import type { CredentialLifecycleService } from '../runtime/credential-lifecycle-service.js';
import type { AnalyticsQueryService } from './analytics-query-service.js';

export function createWebControlPlaneService(options: {
  analyticsQueryService: AnalyticsQueryService;
  credentialLifecycleService: CredentialLifecycleService;
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
    async getAnalyticsOverview(window) {
      options.logger.info('web_control_plane.get_analytics_overview', { window });
      return options.analyticsQueryService.getOverview(window);
    },
    async getAgentAnalytics(agentId, window) {
      options.logger.info('web_control_plane.get_agent_analytics', { agentId, window });
      return options.analyticsQueryService.getAgentAnalytics(agentId, window);
    },
    async getAnalyticsSeries(input) {
      options.logger.info('web_control_plane.get_analytics_series', input ?? {});
      return options.analyticsQueryService.getSeries(input);
    },
    async getAgent(agentId) {
      options.logger.info('web_control_plane.get_agent', { agentId });
      return agentRegistry.getAgent(agentId);
    },
    async getApprovalState(approvalId: ApprovalId) {
      options.logger.info('web_control_plane.get_approval_state', { approvalId });
      const approval = await options.repositories.approvals.findById(approvalId);
      if (!approval) {
        throw new NotFoundError(`Approval '${approvalId}' was not found.`);
      }

      return approval.value.state;
    },
    async listCredentials(agentId) {
      options.logger.info('web_control_plane.list_credentials', { agentId });
      return options.credentialLifecycleService.listCredentialSummaries(agentId);
    },
    async listAgents() {
      options.logger.info('web_control_plane.list_agents');
      return agentRegistry.listAgents();
    },
    async revokeCredential(input) {
      options.logger.info('web_control_plane.revoke_credential', {
        agentId: input.agentId,
        credentialId: input.credentialId,
      });
      return options.credentialLifecycleService.revokeCredential(input);
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

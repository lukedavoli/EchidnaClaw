import type { Agent } from '@echidna-claw/contracts';

import { webApiClient } from '../../lib/api/client.js';

type CreateAgentInput = Pick<Agent, 'name'> & { timeZone?: Agent['timeZone'] | undefined };

export const agentsApi = {
  createAgent(input: CreateAgentInput) {
    return webApiClient.createAgent(input);
  },
  getTelegramProvisioningHandoff(agentId: string) {
    return webApiClient.getTelegramProvisioningHandoff(agentId);
  },
  getReadiness() {
    return webApiClient.getReadiness();
  },
  listAgents() {
    return webApiClient.listAgents();
  },
  retryAgentProvisioning(agentId: string) {
    return webApiClient.retryAgentProvisioning(agentId);
  },
  submitTelegramBotToken(agentId: string, input: { botToken: string }) {
    return webApiClient.submitTelegramBotToken(agentId, input);
  },
  restoreAgent(agentId: string) {
    return webApiClient.restoreAgent(agentId);
  },
  softDeleteAgent(agentId: string) {
    return webApiClient.softDeleteAgent(agentId);
  },
};

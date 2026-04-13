import type { Agent } from '@echidna-claw/contracts';

import { webApiClient } from '../../lib/api/client.js';

type CreateAgentInput = Pick<Agent, 'name'> & { timeZone?: Agent['timeZone'] | undefined };

export const agentsApi = {
  createAgent(input: CreateAgentInput) {
    return webApiClient.createAgent(input);
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
  restoreAgent(agentId: string) {
    return webApiClient.restoreAgent(agentId);
  },
  softDeleteAgent(agentId: string) {
    return webApiClient.softDeleteAgent(agentId);
  },
};

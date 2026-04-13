import type { Agent } from '@echidna-claw/contracts';

import { webApiClient } from '../../lib/api/client.js';

type CreateAgentInput = Pick<Agent, 'name' | 'timeZone'>;

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
  restoreAgent(agentId: string) {
    return webApiClient.restoreAgent(agentId);
  },
  softDeleteAgent(agentId: string) {
    return webApiClient.softDeleteAgent(agentId);
  },
};

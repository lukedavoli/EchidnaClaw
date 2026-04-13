import {
  adminAgentDetailSchema,
  adminAgentSummarySchema,
  approvalIdSchema,
  analyticsOverviewSchema,
  approvalStateSchema,
  errorResponseSchema,
  readinessResponseSchema,
  webCreateAgentRequestSchema,
  type AdminAgentDetail,
  type AdminAgentSummary,
  type Agent,
  type AnalyticsOverview,
  type ReadinessResponse,
} from '@echidna-claw/contracts';
import { z } from 'zod';

import { webConfig } from '../../app/runtime.js';
import { createMutationCorrelation } from './correlation.js';
import { createHttpClient } from './http.js';

const agentsSchema = z.array(adminAgentSummarySchema);
const approvalStateResponseSchema = z
  .object({
    approvalId: approvalIdSchema,
    state: approvalStateSchema,
  })
  .strict();

type CreateWebApiClientOptions = {
  baseUrl?: string;
  fetchImplementation?: typeof fetch;
};

export function createWebApiClient(options: CreateWebApiClientOptions = {}) {
  const http = createHttpClient({
    baseUrl: options.baseUrl ?? webConfig.apiBaseUrl,
    ...(options.fetchImplementation
      ? { fetchImplementation: options.fetchImplementation }
      : {}),
  });

  return {
    createAgent(input: Pick<Agent, 'name'> & { timeZone?: Agent['timeZone'] | undefined }) {
      return http.request({
        acceptableStatusCodes: [201],
        body: webCreateAgentRequestSchema.parse({
          correlation: createMutationCorrelation(),
          name: input.name,
          ...(input.timeZone ? { timeZone: input.timeZone } : {}),
        }),
        method: 'POST',
        path: '/api/admin/agents',
        schema: adminAgentDetailSchema,
      });
    },
    getAgent(agentId: string) {
      return http.request({
        path: `/api/admin/agents/${agentId}`,
        schema: adminAgentDetailSchema,
      }) as Promise<AdminAgentDetail>;
    },
    getAnalyticsOverview() {
      return http.request({
        path: '/api/admin/analytics/overview',
        schema: analyticsOverviewSchema,
      }) as Promise<AnalyticsOverview>;
    },
    getApprovalState(approvalId: string) {
      return http.request({
        path: `/api/admin/approvals/${approvalId}`,
        schema: approvalStateResponseSchema,
      });
    },
    getReadiness() {
      return http.request({
        acceptableStatusCodes: [200, 503],
        path: '/readyz',
        schema: readinessResponseSchema,
      }) as Promise<ReadinessResponse>;
    },
    listAgents() {
      return http.request({
        path: '/api/admin/agents',
        schema: agentsSchema,
      }) as Promise<AdminAgentSummary[]>;
    },
    retryAgentProvisioning(agentId: string) {
      return http.request({
        body: {
          correlation: createMutationCorrelation(),
        },
        method: 'POST',
        path: `/api/admin/agents/${agentId}/provisioning/retry`,
        schema: adminAgentDetailSchema,
      }) as Promise<AdminAgentDetail>;
    },
    restoreAgent(agentId: string) {
      return http.request({
        body: {
          correlation: createMutationCorrelation(),
        },
        method: 'POST',
        path: `/api/admin/agents/${agentId}/restore`,
        schema: adminAgentDetailSchema,
      });
    },
    softDeleteAgent(agentId: string) {
      return http.request({
        body: {
          correlation: createMutationCorrelation(),
        },
        method: 'POST',
        path: `/api/admin/agents/${agentId}/soft-delete`,
        schema: adminAgentDetailSchema,
      });
    },
  };
}

export const webApiClient = createWebApiClient();

export { errorResponseSchema };

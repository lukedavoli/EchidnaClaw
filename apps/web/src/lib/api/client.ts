import {
  adminAgentDetailSchema,
  adminAgentSummarySchema,
  adminTelegramProvisioningHandoffSchema,
  approvalIdSchema,
  analyticsAgentSummarySchema,
  analyticsOverviewSchema,
  approvalStateSchema,
  errorResponseSchema,
  readinessResponseSchema,
  submitTelegramBotTokenRequestSchema,
  webCreateAgentRequestSchema,
  type AdminAgentDetail,
  type AdminAgentSummary,
  type AdminTelegramProvisioningHandoff,
  type Agent,
  type AnalyticsAgentSummary,
  type AnalyticsWindow,
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

function withQuery(path: string, query?: Record<string, string | undefined>) {
  if (!query) {
    return path;
  }

  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value) {
      searchParams.set(key, value);
    }
  }

  const search = searchParams.toString();
  return search.length > 0 ? `${path}?${search}` : path;
}

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
    getTelegramProvisioningHandoff(agentId: string) {
      return http.request({
        path: `/api/admin/agents/${agentId}/telegram-provisioning`,
        schema: adminTelegramProvisioningHandoffSchema,
      }) as Promise<AdminTelegramProvisioningHandoff>;
    },
    getAgent(agentId: string) {
      return http.request({
        path: `/api/admin/agents/${agentId}`,
        schema: adminAgentDetailSchema,
      }) as Promise<AdminAgentDetail>;
    },
    getAnalyticsOverview(window?: AnalyticsWindow) {
      return http.request({
        path: withQuery('/api/admin/analytics/overview', {
          ...(window ? { window } : {}),
        }),
        schema: analyticsOverviewSchema,
      }) as Promise<AnalyticsOverview>;
    },
    getAgentAnalytics(agentId: string, window?: AnalyticsWindow) {
      return http.request({
        path: withQuery(`/api/admin/analytics/agents/${agentId}`, {
          ...(window ? { window } : {}),
        }),
        schema: analyticsAgentSummarySchema,
      }) as Promise<AnalyticsAgentSummary>;
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
    submitTelegramBotToken(
      agentId: string,
      input: {
        botToken: string;
      },
    ) {
      return http.request({
        body: submitTelegramBotTokenRequestSchema.parse({
          correlation: createMutationCorrelation(),
          botToken: input.botToken,
        }),
        method: 'POST',
        path: `/api/admin/agents/${agentId}/telegram-provisioning/token`,
        schema: adminTelegramProvisioningHandoffSchema,
      }) as Promise<AdminTelegramProvisioningHandoff>;
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

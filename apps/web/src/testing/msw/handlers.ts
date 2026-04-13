import {
  correlationMetadataSchema,
  errorResponseSchema,
  readinessResponseSchema,
  webCreateAgentRequestSchema,
  type AdminAgentSummary,
  type AnalyticsOverview,
} from '@echidna-claw/contracts';
import { http, HttpResponse } from 'msw';
import { z } from 'zod';

import {
  createAdminAgentDetailFixture,
  createAdminAgentSummaryFixture,
  createAnalyticsOverviewFixture,
} from '../fixtures/records.js';

export const mockApiBaseUrl = 'http://127.0.0.1:3001';

const mutationBodySchema = z
  .object({
    correlation: correlationMetadataSchema,
  })
  .strict();

type AgentMode = 'ready' | 'not-implemented' | 'unavailable';
type AnalyticsMode = 'ready' | 'not-implemented' | 'unavailable';

type MockState = {
  agentMode: AgentMode;
  agents: AdminAgentSummary[];
  analyticsMode: AnalyticsMode;
  analyticsOverview: AnalyticsOverview;
  nextAgentId: number;
  readinessReady: boolean;
};

function createDefaultState(): MockState {
  return {
    agentMode: 'ready',
    agents: [
      createAdminAgentSummaryFixture(),
      createAdminAgentSummaryFixture({
        agent: {
          id: 'agt_fixture-archive',
          lifecycleState: 'soft_deleted',
          name: 'Archived Escalation Agent',
          primaryChannelId: 'chn_fixture-archive',
          restoredAt: null,
          softDeletedAt: '2026-04-12T10:00:00.000Z',
          updatedAt: '2026-04-12T10:00:00.000Z',
        },
        primaryChannel: {
          agentId: 'agt_fixture-archive',
          id: 'chn_fixture-archive',
          updatedAt: '2026-04-12T10:00:00.000Z',
        },
      }),
    ],
    analyticsMode: 'ready',
    analyticsOverview: createAnalyticsOverviewFixture(),
    nextAgentId: 3,
    readinessReady: true,
  };
}

let state = createDefaultState();

function createStructuredError(
  status: number,
  code: string,
  message: string,
  retryable: boolean,
  traceId = 'trc_mock-api',
) {
  return HttpResponse.json(
    errorResponseSchema.parse({
      error: {
        code,
        message,
        retryable,
        traceId,
      },
    }),
    {
      headers: {
        'x-trace-id': traceId,
      },
      status,
    },
  );
}

function updateAnalyticsTotals() {
  state.analyticsOverview = createAnalyticsOverviewFixture(state.analyticsOverview.events);
}

function upsertAgentSummary(updated: AdminAgentSummary) {
  state.agents = state.agents.map((entry) => (entry.agent.id === updated.agent.id ? updated : entry));
}

function getAgentSummary(agentId: string): AdminAgentSummary | undefined {
  return state.agents.find((entry) => entry.agent.id === agentId);
}

function createPendingAgentSummary(input: {
  correlation: unknown;
  createdAt: string;
  id: string;
  name: string;
  timeZone?: string | undefined;
}) {
  return createAdminAgentDetailFixture({
    agent: {
      correlation: input.correlation as never,
      createdAt: input.createdAt,
      id: input.id,
      name: input.name,
      primaryChannelId: `chn_${input.id.replace(/^agt_/, '')}`,
      provisioningState: 'pending_provisioning',
      timeZone: input.timeZone ?? 'Australia/Sydney',
      updatedAt: input.createdAt,
    },
    primaryChannel: {
      agentId: input.id,
      botDisplayName: undefined,
      botUserId: undefined,
      boundAt: null,
      correlation: input.correlation as never,
      createdAt: input.createdAt,
      externalChatId: undefined,
      externalHandle: undefined,
      id: `chn_${input.id.replace(/^agt_/, '')}`,
      lastProvisioningErrorCode: undefined,
      lastProvisioningErrorMessage: undefined,
      lastProvisioningFailedAt: null,
      lastRecoveryRequestedAt: null,
      provisioningRequestedAt: input.createdAt,
      provisioningStartedAt: null,
      recoveryAttemptCount: 0,
      state: 'pending_provisioning',
      updatedAt: input.createdAt,
    },
  });
}

export const mockWebApiState = {
  addAgent(agent: AdminAgentSummary) {
    state.agents = [agent, ...state.agents];
  },
  reset() {
    state = createDefaultState();
  },
  setAgentMode(mode: AgentMode) {
    state.agentMode = mode;
  },
  setAgents(agents: AdminAgentSummary[]) {
    state.agents = agents;
  },
  setAnalyticsMode(mode: AnalyticsMode) {
    state.analyticsMode = mode;
  },
  setAnalyticsOverview(overview: AnalyticsOverview) {
    state.analyticsOverview = overview;
  },
  setReadiness(ready: boolean) {
    state.readinessReady = ready;
  },
};

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

export async function resolveMockApiRequest(request: Request) {
  const url = new URL(request.url);

  if (url.origin !== mockApiBaseUrl) {
    return null;
  }

  if (request.method === 'GET' && url.pathname === '/readyz') {
    const body = readinessResponseSchema.parse({
      dependencies: {
        repositories: {
          description: 'Repository adapters use the in-memory suite for local-minimal development.',
          mode: 'in_memory',
          ready: state.readinessReady,
        },
      },
      runtimeMode: 'local-minimal',
      service: 'api',
      status: state.readinessReady ? 'ready' : 'not_ready',
    });

    return jsonResponse(body, {
      status: state.readinessReady ? 200 : 503,
    });
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/agents') {
    if (state.agentMode === 'not-implemented') {
      return createStructuredError(
        501,
        'not_implemented_yet',
        'Agent persistence is reserved for Step 5.',
        false,
      );
    }

    if (state.agentMode === 'unavailable') {
      return createStructuredError(
        503,
        'dependency_unavailable',
        'Repository dependencies are unavailable.',
        true,
      );
    }

    return jsonResponse(state.agents);
  }

  const getAgentMatch = url.pathname.match(/^\/api\/admin\/agents\/([^/]+)$/);

  if (request.method === 'GET' && getAgentMatch) {
    const agent = getAgentSummary(String(getAgentMatch[1]));

    if (!agent) {
      return createStructuredError(404, 'not_found', 'Agent not found.', false);
    }

    return jsonResponse(agent);
  }

  if (request.method === 'POST' && url.pathname === '/api/admin/agents') {
    if (state.agentMode === 'not-implemented') {
      return createStructuredError(
        501,
        'not_implemented_yet',
        'Agent persistence is reserved for Step 5.',
        false,
      );
    }

    if (state.agentMode === 'unavailable') {
      return createStructuredError(
        503,
        'dependency_unavailable',
        'Repository dependencies are unavailable.',
        true,
      );
    }

    const body = webCreateAgentRequestSchema.parse(await request.json());
    const createdAt = `2026-04-13T0${state.nextAgentId}:00:00.000Z`;
    const agent = createPendingAgentSummary({
      correlation: body.correlation,
      createdAt,
      id: `agt_created-${state.nextAgentId}`,
      name: body.name,
      timeZone: body.timeZone,
    });

    state.nextAgentId += 1;
    state.agents = [agent, ...state.agents];

    return jsonResponse(agent, { status: 201 });
  }

  const softDeleteMatch = url.pathname.match(/^\/api\/admin\/agents\/([^/]+)\/soft-delete$/);

  if (request.method === 'POST' && softDeleteMatch) {
    mutationBodySchema.parse(await request.json());

    const agent = getAgentSummary(String(softDeleteMatch[1]));

    if (!agent) {
      return createStructuredError(404, 'not_found', 'Agent not found.', false);
    }

    const updated = createAdminAgentDetailFixture({
      agent: {
        ...agent.agent,
        lifecycleState: 'soft_deleted',
        restoredAt: null,
        softDeletedAt: '2026-04-13T11:00:00.000Z',
        updatedAt: '2026-04-13T11:00:00.000Z',
      },
      primaryChannel: agent.primaryChannel
        ? {
            ...agent.primaryChannel,
            agentId: agent.agent.id,
            updatedAt: '2026-04-13T11:00:00.000Z',
          }
        : null,
    });

    upsertAgentSummary(updated);

    return jsonResponse(updated);
  }

  const restoreMatch = url.pathname.match(/^\/api\/admin\/agents\/([^/]+)\/restore$/);

  if (request.method === 'POST' && restoreMatch) {
    mutationBodySchema.parse(await request.json());

    const agent = getAgentSummary(String(restoreMatch[1]));

    if (!agent) {
      return createStructuredError(404, 'not_found', 'Agent not found.', false);
    }

    const updated = createAdminAgentDetailFixture({
      agent: {
        ...agent.agent,
        lifecycleState: 'active',
        restoredAt: '2026-04-13T11:30:00.000Z',
        softDeletedAt: null,
        updatedAt: '2026-04-13T11:30:00.000Z',
      },
      primaryChannel: agent.primaryChannel
        ? {
            ...agent.primaryChannel,
            agentId: agent.agent.id,
            updatedAt: '2026-04-13T11:30:00.000Z',
          }
        : null,
    });

    upsertAgentSummary(updated);

    return jsonResponse(updated);
  }

  const retryMatch = url.pathname.match(/^\/api\/admin\/agents\/([^/]+)\/provisioning\/retry$/);

  if (request.method === 'POST' && retryMatch) {
    mutationBodySchema.parse(await request.json());

    const agent = getAgentSummary(String(retryMatch[1]));

    if (!agent) {
      return createStructuredError(404, 'not_found', 'Agent not found.', false);
    }

    if (agent.agent.lifecycleState === 'soft_deleted' || agent.primaryChannel?.state !== 'provisioning_failed') {
      return createStructuredError(
        409,
        'state_conflict',
        'Retry provisioning requires an active agent whose primary channel is provisioning_failed.',
        false,
      );
    }

    const updated = createAdminAgentDetailFixture({
      agent: {
        ...agent.agent,
        provisioningState: 'pending_provisioning',
        updatedAt: '2026-04-13T12:00:00.000Z',
      },
      primaryChannel: agent.primaryChannel
        ? {
            ...agent.primaryChannel,
            agentId: agent.agent.id,
            lastRecoveryRequestedAt: '2026-04-13T12:00:00.000Z',
            provisioningStartedAt: null,
            recoveryAttemptCount: agent.primaryChannel.recoveryAttemptCount + 1,
            state: 'pending_provisioning',
            updatedAt: '2026-04-13T12:00:00.000Z',
          }
        : null,
    });

    upsertAgentSummary(updated);

    return jsonResponse(updated);
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/analytics/overview') {
    if (state.analyticsMode === 'not-implemented') {
      return createStructuredError(
        501,
        'not_implemented_yet',
        'Analytics aggregation is reserved for Step 18.',
        false,
      );
    }

    if (state.analyticsMode === 'unavailable') {
      return createStructuredError(
        503,
        'dependency_unavailable',
        'Analytics dependencies are unavailable.',
        true,
      );
    }

    updateAnalyticsTotals();
    return jsonResponse(state.analyticsOverview);
  }

  const approvalMatch = url.pathname.match(/^\/api\/admin\/approvals\/([^/]+)$/);

  if (request.method === 'GET' && approvalMatch) {
    return jsonResponse({
      approvalId: approvalMatch[1],
      state: 'requested',
    });
  }

  return null;
}

export const handlers = [
  http.get(`${mockApiBaseUrl}/readyz`, () => {
    const body = readinessResponseSchema.parse({
      dependencies: {
        repositories: {
          description: 'Repository adapters use the in-memory suite for local-minimal development.',
          mode: 'in_memory',
          ready: state.readinessReady,
        },
      },
      runtimeMode: 'local-minimal',
      service: 'api',
      status: state.readinessReady ? 'ready' : 'not_ready',
    });

    return HttpResponse.json(body, {
      status: state.readinessReady ? 200 : 503,
    });
  }),

  http.get(`${mockApiBaseUrl}/api/admin/agents`, () => {
    if (state.agentMode === 'not-implemented') {
      return createStructuredError(
        501,
        'not_implemented_yet',
        'Agent persistence is reserved for Step 5.',
        false,
      );
    }

    if (state.agentMode === 'unavailable') {
      return createStructuredError(
        503,
        'dependency_unavailable',
        'Repository dependencies are unavailable.',
        true,
      );
    }

    return HttpResponse.json(state.agents);
  }),

  http.get(`${mockApiBaseUrl}/api/admin/agents/:agentId`, ({ params }) => {
    const agent = getAgentSummary(String(params.agentId));

    if (!agent) {
      return createStructuredError(404, 'not_found', 'Agent not found.', false);
    }

    return HttpResponse.json(agent);
  }),

  http.post(`${mockApiBaseUrl}/api/admin/agents`, async ({ request }) => {
    if (state.agentMode === 'not-implemented') {
      return createStructuredError(
        501,
        'not_implemented_yet',
        'Agent persistence is reserved for Step 5.',
        false,
      );
    }

    if (state.agentMode === 'unavailable') {
      return createStructuredError(
        503,
        'dependency_unavailable',
        'Repository dependencies are unavailable.',
        true,
      );
    }

    const body = webCreateAgentRequestSchema.parse(await request.json());
    const createdAt = `2026-04-13T0${state.nextAgentId}:00:00.000Z`;
    const agent = createPendingAgentSummary({
      correlation: body.correlation,
      createdAt,
      id: `agt_created-${state.nextAgentId}`,
      name: body.name,
      timeZone: body.timeZone,
    });

    state.nextAgentId += 1;
    state.agents = [agent, ...state.agents];

    return HttpResponse.json(agent, { status: 201 });
  }),

  http.post(`${mockApiBaseUrl}/api/admin/agents/:agentId/soft-delete`, async ({ params, request }) => {
    mutationBodySchema.parse(await request.json());

    const agent = getAgentSummary(String(params.agentId));

    if (!agent) {
      return createStructuredError(404, 'not_found', 'Agent not found.', false);
    }

    const updated = createAdminAgentDetailFixture({
      agent: {
        ...agent.agent,
        lifecycleState: 'soft_deleted',
        restoredAt: null,
        softDeletedAt: '2026-04-13T11:00:00.000Z',
        updatedAt: '2026-04-13T11:00:00.000Z',
      },
      primaryChannel: agent.primaryChannel
        ? {
            ...agent.primaryChannel,
            agentId: agent.agent.id,
            updatedAt: '2026-04-13T11:00:00.000Z',
          }
        : null,
    });

    upsertAgentSummary(updated);

    return HttpResponse.json(updated);
  }),

  http.post(`${mockApiBaseUrl}/api/admin/agents/:agentId/restore`, async ({ params, request }) => {
    mutationBodySchema.parse(await request.json());

    const agent = getAgentSummary(String(params.agentId));

    if (!agent) {
      return createStructuredError(404, 'not_found', 'Agent not found.', false);
    }

    const updated = createAdminAgentDetailFixture({
      agent: {
        ...agent.agent,
        lifecycleState: 'active',
        restoredAt: '2026-04-13T11:30:00.000Z',
        softDeletedAt: null,
        updatedAt: '2026-04-13T11:30:00.000Z',
      },
      primaryChannel: agent.primaryChannel
        ? {
            ...agent.primaryChannel,
            agentId: agent.agent.id,
            updatedAt: '2026-04-13T11:30:00.000Z',
          }
        : null,
    });

    upsertAgentSummary(updated);

    return HttpResponse.json(updated);
  }),

  http.post(`${mockApiBaseUrl}/api/admin/agents/:agentId/provisioning/retry`, async ({ params, request }) => {
    mutationBodySchema.parse(await request.json());

    const agent = getAgentSummary(String(params.agentId));

    if (!agent) {
      return createStructuredError(404, 'not_found', 'Agent not found.', false);
    }

    if (agent.agent.lifecycleState === 'soft_deleted' || agent.primaryChannel?.state !== 'provisioning_failed') {
      return createStructuredError(
        409,
        'state_conflict',
        'Retry provisioning requires an active agent whose primary channel is provisioning_failed.',
        false,
      );
    }

    const updated = createAdminAgentDetailFixture({
      agent: {
        ...agent.agent,
        provisioningState: 'pending_provisioning',
        updatedAt: '2026-04-13T12:00:00.000Z',
      },
      primaryChannel: agent.primaryChannel
        ? {
            ...agent.primaryChannel,
            agentId: agent.agent.id,
            lastRecoveryRequestedAt: '2026-04-13T12:00:00.000Z',
            provisioningStartedAt: null,
            recoveryAttemptCount: agent.primaryChannel.recoveryAttemptCount + 1,
            state: 'pending_provisioning',
            updatedAt: '2026-04-13T12:00:00.000Z',
          }
        : null,
    });

    upsertAgentSummary(updated);

    return HttpResponse.json(updated);
  }),

  http.get(`${mockApiBaseUrl}/api/admin/analytics/overview`, () => {
    if (state.analyticsMode === 'not-implemented') {
      return createStructuredError(
        501,
        'not_implemented_yet',
        'Analytics aggregation is reserved for Step 18.',
        false,
      );
    }

    if (state.analyticsMode === 'unavailable') {
      return createStructuredError(
        503,
        'dependency_unavailable',
        'Analytics dependencies are unavailable.',
        true,
      );
    }

    updateAnalyticsTotals();
    return HttpResponse.json(state.analyticsOverview);
  }),

  http.get(`${mockApiBaseUrl}/api/admin/approvals/:approvalId`, ({ params }) =>
    HttpResponse.json({
      approvalId: params.approvalId,
      state: 'requested',
    })),
];

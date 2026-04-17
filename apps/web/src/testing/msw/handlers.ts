import {
  adminTelegramProvisioningHandoffSchema,
  correlationMetadataSchema,
  errorResponseSchema,
  readinessResponseSchema,
  submitTelegramBotTokenRequestSchema,
  webCreateAgentRequestSchema,
  type AdminAgentSummary,
  type AdminTelegramProvisioningHandoff,
  type AnalyticsOverview,
} from '@echidna-claw/contracts';
import { http, HttpResponse } from 'msw';
import { z } from 'zod';

import {
  createAdminAgentDetailFixture,
  createAdminAgentSummaryFixture,
  createAnalyticsOverviewFixture,
  createTelegramProvisioningHandoffFixture,
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
  provisioningHandoffs: Record<string, AdminTelegramProvisioningHandoff>;
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
    provisioningHandoffs: {},
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

function deriveProvisioningHandoff(
  agent: AdminAgentSummary,
): AdminTelegramProvisioningHandoff {
  const primaryChannel = agent.primaryChannel;
  if (!primaryChannel) {
    return createTelegramProvisioningHandoffFixture({
      agentId: agent.agent.id,
      channelId: agent.agent.primaryChannelId,
      instructions: ['The primary Telegram channel is missing for this agent.'],
      lastErrorCode: 'broken_registry_invariant',
      lastErrorMessage: 'The primary Telegram channel is missing for this agent.',
      provider: 'telegram',
      state: 'failed',
    });
  }

  if (primaryChannel.state === 'active') {
    return createTelegramProvisioningHandoffFixture({
      agentId: agent.agent.id,
      botDisplayName: primaryChannel.botDisplayName ?? null,
      botHandle: primaryChannel.externalHandle ?? null,
      channelId: primaryChannel.id,
      instructions: [
        primaryChannel.externalHandle
          ? `Provisioning is complete and @${primaryChannel.externalHandle} is active.`
          : 'Provisioning is complete and the Telegram bot is active.',
      ],
      openTelegramUrl: primaryChannel.conversationUrl ?? null,
      operatorActionUrl: primaryChannel.conversationUrl ?? null,
      provider: 'telegram',
      requiresBotToken: false,
      state: 'completed',
    });
  }

  if (primaryChannel.state === 'provisioning_failed') {
    return createTelegramProvisioningHandoffFixture({
      agentId: agent.agent.id,
      botDisplayName: primaryChannel.botDisplayName ?? null,
      botHandle: primaryChannel.externalHandle ?? null,
      channelId: primaryChannel.id,
      instructions: [
        primaryChannel.lastProvisioningErrorMessage ?? 'The last provisioning attempt failed.',
        'Retry the flow or paste a replacement token to continue.',
      ],
      lastErrorCode: primaryChannel.lastProvisioningErrorCode ?? 'telegram_bind_failed',
      lastErrorMessage:
        primaryChannel.lastProvisioningErrorMessage ??
        'The last provisioning attempt failed.',
      provider: 'telegram',
      requiresBotToken: primaryChannel.credentialId == null,
      state: 'failed',
    });
  }

  return createTelegramProvisioningHandoffFixture({
    agentId: agent.agent.id,
    botDisplayName: primaryChannel.botDisplayName ?? null,
    botHandle: primaryChannel.externalHandle ?? null,
    channelId: primaryChannel.id,
  });
}

function getProvisioningHandoff(agentId: string): AdminTelegramProvisioningHandoff | undefined {
  return state.provisioningHandoffs[agentId] ?? (() => {
    const agent = getAgentSummary(agentId);
    return agent ? deriveProvisioningHandoff(agent) : undefined;
  })();
}

function upsertProvisioningHandoff(handoff: AdminTelegramProvisioningHandoff) {
  state.provisioningHandoffs[handoff.agentId] = adminTelegramProvisioningHandoffSchema.parse(
    handoff,
  );
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
  setProvisioningHandoff(handoff: AdminTelegramProvisioningHandoff) {
    upsertProvisioningHandoff(handoff);
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
    upsertProvisioningHandoff(
      createTelegramProvisioningHandoffFixture({
        agentId: agent.agent.id,
        channelId: agent.agent.primaryChannelId,
      }),
    );

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
    const currentHandoff = getProvisioningHandoff(agent.agent.id);
    upsertProvisioningHandoff(
      createTelegramProvisioningHandoffFixture({
        agentId: agent.agent.id,
        attemptNumber: (currentHandoff?.attemptNumber ?? 0) + 1,
        bootstrapCode:
          currentHandoff && !currentHandoff.requiresBotToken && currentHandoff.botHandle
            ? 'retry-bootstrap-code'
            : null,
        bootstrapExpiresAt:
          currentHandoff && !currentHandoff.requiresBotToken && currentHandoff.botHandle
            ? '2026-04-13T12:30:00.000Z'
            : null,
        botDisplayName: currentHandoff?.botDisplayName ?? null,
        botHandle: currentHandoff?.botHandle ?? null,
        channelId: agent.agent.primaryChannelId,
        instructions:
          currentHandoff && !currentHandoff.requiresBotToken && currentHandoff.botHandle
            ? [
                'Open the Telegram deep link from the intended operator account to send the one-time bootstrap code.',
                'Only that bootstrap message can bind the trusted Telegram user and chat to this agent.',
              ]
            : [
                'Create a Telegram bot in BotFather or choose an existing bot.',
                'Paste the bot token here so the platform can verify it and configure the webhook.',
              ],
        lastErrorCode: null,
        lastErrorMessage: null,
        openTelegramUrl:
          currentHandoff && !currentHandoff.requiresBotToken && currentHandoff.botHandle
            ? `https://t.me/${currentHandoff.botHandle}?start=retry-bootstrap-code`
            : null,
        operatorActionUrl:
          currentHandoff && !currentHandoff.requiresBotToken && currentHandoff.botHandle
            ? `https://t.me/${currentHandoff.botHandle}?start=retry-bootstrap-code`
            : 'https://t.me/BotFather',
        provider: 'telegram',
        requiresBotToken: currentHandoff?.requiresBotToken ?? true,
        state:
          currentHandoff && !currentHandoff.requiresBotToken && currentHandoff.botHandle
            ? 'awaiting_operator_binding'
            : 'pending_operator_action',
      }),
    );

    return jsonResponse(updated);
  }

  const provisioningMatch = url.pathname.match(
    /^\/api\/admin\/agents\/([^/]+)\/telegram-provisioning$/,
  );

  if (request.method === 'GET' && provisioningMatch) {
    const handoff = getProvisioningHandoff(String(provisioningMatch[1]));

    if (!handoff) {
      return createStructuredError(404, 'not_found', 'Agent not found.', false);
    }

    return jsonResponse(handoff);
  }

  const submitTokenMatch = url.pathname.match(
    /^\/api\/admin\/agents\/([^/]+)\/telegram-provisioning\/token$/,
  );

  if (request.method === 'POST' && submitTokenMatch) {
    const agentId = String(submitTokenMatch[1]);
    const agent = getAgentSummary(agentId);
    if (!agent) {
      return createStructuredError(404, 'not_found', 'Agent not found.', false);
    }

    const body = submitTelegramBotTokenRequestSchema.parse(await request.json());
    if (body.botToken.toLowerCase().includes('bad')) {
      upsertProvisioningHandoff(
        createTelegramProvisioningHandoffFixture({
          agentId,
          channelId: agent.agent.primaryChannelId,
          instructions: [
            'Telegram rejected the provided bot token.',
            'Paste a replacement token to continue.',
          ],
          lastErrorCode: 'telegram_token_invalid',
          lastErrorMessage: 'Telegram rejected the provided bot token.',
          provider: 'telegram',
          state: 'failed',
        }),
      );
      return createStructuredError(
        400,
        'validation_failed',
        'Telegram rejected the provided bot token.',
        false,
      );
    }

    const handoff = createTelegramProvisioningHandoffFixture({
      agentId,
      botDisplayName: 'Ops Triage Bot',
      botHandle: 'ops-triage-bot',
      channelId: agent.agent.primaryChannelId,
      instructions: [
        'Open the Telegram deep link from the intended operator account to send the one-time bootstrap code.',
        'Only that bootstrap message can bind the trusted Telegram user and chat to this agent.',
      ],
      openTelegramUrl: 'https://t.me/ops-triage-bot?start=bootstrap-code-123',
      operatorActionUrl: 'https://t.me/ops-triage-bot?start=bootstrap-code-123',
      provider: 'telegram',
      requiresBotToken: false,
      state: 'awaiting_operator_binding',
      bootstrapCode: 'bootstrap-code-123',
      bootstrapExpiresAt: '2026-04-13T12:30:00.000Z',
    });
    upsertProvisioningHandoff(handoff);
    upsertAgentSummary(
      createAdminAgentDetailFixture({
        agent: {
          ...agent.agent,
          provisioningState: 'provisioning',
          updatedAt: '2026-04-13T12:05:00.000Z',
        },
        primaryChannel: agent.primaryChannel
          ? {
              ...agent.primaryChannel,
              agentId,
              botDisplayName: 'Ops Triage Bot',
              botUserId: 'bot-user-1',
              credentialId: 'crd_fixture-telegram',
              state: 'provisioning',
              updatedAt: '2026-04-13T12:05:00.000Z',
            }
          : null,
      }),
    );

    return jsonResponse(handoff);
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
    upsertProvisioningHandoff(
      createTelegramProvisioningHandoffFixture({
        agentId: agent.agent.id,
        channelId: agent.agent.primaryChannelId,
      }),
    );

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

  http.get(`${mockApiBaseUrl}/api/admin/agents/:agentId/telegram-provisioning`, ({ params }) => {
    const handoff = getProvisioningHandoff(String(params.agentId));

    if (!handoff) {
      return createStructuredError(404, 'not_found', 'Agent not found.', false);
    }

    return HttpResponse.json(handoff);
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
    const currentHandoff = getProvisioningHandoff(agent.agent.id);
    upsertProvisioningHandoff(
      createTelegramProvisioningHandoffFixture({
        agentId: agent.agent.id,
        attemptNumber: (currentHandoff?.attemptNumber ?? 0) + 1,
        bootstrapCode:
          currentHandoff && !currentHandoff.requiresBotToken && currentHandoff.botHandle
            ? 'retry-bootstrap-code'
            : null,
        bootstrapExpiresAt:
          currentHandoff && !currentHandoff.requiresBotToken && currentHandoff.botHandle
            ? '2026-04-13T12:30:00.000Z'
            : null,
        botDisplayName: currentHandoff?.botDisplayName ?? null,
        botHandle: currentHandoff?.botHandle ?? null,
        channelId: agent.agent.primaryChannelId,
        instructions:
          currentHandoff && !currentHandoff.requiresBotToken && currentHandoff.botHandle
            ? [
                'Open the Telegram deep link from the intended operator account to send the one-time bootstrap code.',
                'Only that bootstrap message can bind the trusted Telegram user and chat to this agent.',
              ]
            : [
                'Create a Telegram bot in BotFather or choose an existing bot.',
                'Paste the bot token here so the platform can verify it and configure the webhook.',
              ],
        lastErrorCode: null,
        lastErrorMessage: null,
        openTelegramUrl:
          currentHandoff && !currentHandoff.requiresBotToken && currentHandoff.botHandle
            ? `https://t.me/${currentHandoff.botHandle}?start=retry-bootstrap-code`
            : null,
        operatorActionUrl:
          currentHandoff && !currentHandoff.requiresBotToken && currentHandoff.botHandle
            ? `https://t.me/${currentHandoff.botHandle}?start=retry-bootstrap-code`
            : 'https://t.me/BotFather',
        provider: 'telegram',
        requiresBotToken: currentHandoff?.requiresBotToken ?? true,
        state:
          currentHandoff && !currentHandoff.requiresBotToken && currentHandoff.botHandle
            ? 'awaiting_operator_binding'
            : 'pending_operator_action',
      }),
    );

    return HttpResponse.json(updated);
  }),

  http.post(
    `${mockApiBaseUrl}/api/admin/agents/:agentId/telegram-provisioning/token`,
    async ({ params, request }) => {
      const agentId = String(params.agentId);
      const agent = getAgentSummary(agentId);
      if (!agent) {
        return createStructuredError(404, 'not_found', 'Agent not found.', false);
      }

      const body = submitTelegramBotTokenRequestSchema.parse(await request.json());
      if (body.botToken.toLowerCase().includes('bad')) {
        upsertProvisioningHandoff(
          createTelegramProvisioningHandoffFixture({
            agentId,
            channelId: agent.agent.primaryChannelId,
            instructions: [
              'Telegram rejected the provided bot token.',
              'Paste a replacement token to continue.',
            ],
            lastErrorCode: 'telegram_token_invalid',
            lastErrorMessage: 'Telegram rejected the provided bot token.',
            provider: 'telegram',
            state: 'failed',
          }),
        );
        return createStructuredError(
          400,
          'validation_failed',
          'Telegram rejected the provided bot token.',
          false,
        );
      }

      const handoff = createTelegramProvisioningHandoffFixture({
        agentId,
        botDisplayName: 'Ops Triage Bot',
        botHandle: 'ops-triage-bot',
        channelId: agent.agent.primaryChannelId,
        instructions: [
          'Open the Telegram deep link from the intended operator account to send the one-time bootstrap code.',
          'Only that bootstrap message can bind the trusted Telegram user and chat to this agent.',
        ],
        openTelegramUrl: 'https://t.me/ops-triage-bot?start=bootstrap-code-123',
        operatorActionUrl: 'https://t.me/ops-triage-bot?start=bootstrap-code-123',
        provider: 'telegram',
        requiresBotToken: false,
        state: 'awaiting_operator_binding',
        bootstrapCode: 'bootstrap-code-123',
        bootstrapExpiresAt: '2026-04-13T12:30:00.000Z',
      });
      upsertProvisioningHandoff(handoff);
      upsertAgentSummary(
        createAdminAgentDetailFixture({
          agent: {
            ...agent.agent,
            provisioningState: 'provisioning',
            updatedAt: '2026-04-13T12:05:00.000Z',
          },
          primaryChannel: agent.primaryChannel
            ? {
                ...agent.primaryChannel,
                agentId,
                botDisplayName: 'Ops Triage Bot',
                botUserId: 'bot-user-1',
                credentialId: 'crd_fixture-telegram',
                state: 'provisioning',
                updatedAt: '2026-04-13T12:05:00.000Z',
              }
            : null,
        }),
      );

      return HttpResponse.json(handoff);
    },
  ),

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

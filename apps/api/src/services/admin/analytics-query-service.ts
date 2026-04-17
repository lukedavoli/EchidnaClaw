import type {
  AgentId,
  AnalyticsAgentSummary,
  AnalyticsOverview,
  AnalyticsSeriesResponse,
  AnalyticsWindow,
  RepositoryConfig,
} from '@echidna-claw/contracts';
import {
  buildAgentAnalyticsSummary,
  buildAnalyticsOverview,
  buildAnalyticsSeries,
  type Logger,
} from '@echidna-claw/observability';

import type { RepositoryBundle } from '../../adapters/repositories/index.js';
import { NotFoundError } from '../../http/errors.js';

function resolveWindow(
  repositoryConfig: RepositoryConfig,
  window?: AnalyticsWindow,
): AnalyticsWindow {
  return window ?? repositoryConfig.observability.analyticsDefaultWindow;
}

export interface AnalyticsQueryService {
  getAgentAnalytics(agentId: AgentId, window?: AnalyticsWindow): Promise<AnalyticsAgentSummary>;
  getOverview(window?: AnalyticsWindow): Promise<AnalyticsOverview>;
  getSeries(input?: {
    agentId?: AgentId;
    window?: AnalyticsWindow;
  }): Promise<AnalyticsSeriesResponse>;
}

export function createAnalyticsQueryService(options: {
  logger: Logger;
  repositories: RepositoryBundle;
  repositoryConfig: RepositoryConfig;
}): AnalyticsQueryService {
  async function loadAgentNames(): Promise<Map<string, string>> {
    const agents = await options.repositories.agents.list();
    return new Map(agents.map((storedAgent) => [storedAgent.value.id, storedAgent.value.name]));
  }

  async function loadWindowEvents(window: AnalyticsWindow, agentId?: AgentId) {
    return options.repositories.usageEvents.listWindow({
      ...(agentId ? { agentId } : {}),
    });
  }

  return {
    async getOverview(window) {
      const effectiveWindow = resolveWindow(options.repositoryConfig, window);
      const [agentNames, storedEvents] = await Promise.all([
        loadAgentNames(),
        loadWindowEvents(effectiveWindow),
      ]);
      const overview = buildAnalyticsOverview({
        agentNames,
        asOf: new Date().toISOString(),
        events: storedEvents.map((storedEvent) => storedEvent.value),
        includeCompatibilityEvents:
          options.repositoryConfig.observability.compatibilityRawEventsEnabled,
        maxPoints: options.repositoryConfig.observability.analyticsMaxChartPoints,
        window: effectiveWindow,
      });

      options.logger.info('analytics_query.get_overview', {
        eventCount: overview.totals.eventCount,
        window: effectiveWindow,
      });

      return overview;
    },

    async getAgentAnalytics(agentId, window) {
      const effectiveWindow = resolveWindow(options.repositoryConfig, window);
      const [storedAgent, storedEvents] = await Promise.all([
        options.repositories.agents.get(agentId),
        loadWindowEvents(effectiveWindow, agentId),
      ]);

      if (!storedAgent) {
        throw new NotFoundError(`Agent '${agentId}' was not found.`);
      }

      const summary = buildAgentAnalyticsSummary({
        agentId,
        agentName: storedAgent.value.name,
        asOf: new Date().toISOString(),
        events: storedEvents.map((storedEvent) => storedEvent.value),
        includeCompatibilityEvents:
          options.repositoryConfig.observability.compatibilityRawEventsEnabled,
        maxPoints: options.repositoryConfig.observability.analyticsMaxChartPoints,
        window: effectiveWindow,
      });

      options.logger.info('analytics_query.get_agent_analytics', {
        agentId,
        eventCount: summary.totals.eventCount,
        window: effectiveWindow,
      });

      return summary;
    },

    async getSeries(input) {
      const effectiveWindow = resolveWindow(options.repositoryConfig, input?.window);
      const storedEvents = await loadWindowEvents(effectiveWindow, input?.agentId);
      const series = buildAnalyticsSeries({
        ...(input?.agentId ? { agentId: input.agentId } : {}),
        asOf: new Date().toISOString(),
        events: storedEvents.map((storedEvent) => storedEvent.value),
        maxPoints: options.repositoryConfig.observability.analyticsMaxChartPoints,
        window: effectiveWindow,
      });

      options.logger.info('analytics_query.get_series', {
        agentId: input?.agentId,
        pointCount: series.series.length,
        window: effectiveWindow,
      });

      return series;
    },
  };
}

import {
  analyticsWindowSchema,
  type AnalyticsAgentSummary,
  type AnalyticsOverview,
  type AnalyticsSeriesPoint,
  type AnalyticsTimeGrain,
  type AnalyticsWindow,
} from '@echidna-claw/contracts';

import { formatCurrency, formatInteger } from '../../lib/formatting/numbers.js';
import { humanizeEnumValue } from '../../lib/formatting/status.js';

export type AnalyticsSeriesChartPoint = {
  bucketLabel: string;
  estimatedCostUsd: number;
  eventCount: number;
  inputTokens: number;
  outputTokens: number;
};

export type AnalyticsBreakdownRow = {
  estimatedCostLabel: string;
  eventCountLabel: string;
  label: string;
};

export type AnalyticsTopAgentRow = {
  agentId: string;
  agentName: string;
  estimatedCostLabel: string;
  eventCountLabel: string;
};

export type AnalyticsOverviewViewModel = {
  byModelRows: AnalyticsBreakdownRow[];
  bySourceRows: AnalyticsBreakdownRow[];
  eventCountLabel: string;
  hasEvents: boolean;
  seriesData: AnalyticsSeriesChartPoint[];
  topAgentRows: AnalyticsTopAgentRow[];
  totalEstimatedCostLabel: string;
  totalInputTokensLabel: string;
  totalOutputTokensLabel: string;
  window: AnalyticsWindow;
};

export type AgentAnalyticsViewModel = {
  agentId: string;
  agentName: string;
  eventCountLabel: string;
  hasEvents: boolean;
  seriesData: AnalyticsSeriesChartPoint[];
  totalEstimatedCostLabel: string;
  totalInputTokensLabel: string;
  totalOutputTokensLabel: string;
  window: AnalyticsWindow;
};

export const analyticsWindowOptions: Array<{ label: string; value: AnalyticsWindow }> = [
  { label: '1 hour', value: '1h' },
  { label: '24 hours', value: '24h' },
  { label: '7 days', value: '7d' },
  { label: '30 days', value: '30d' },
  { label: '90 days', value: '90d' },
  { label: 'All time', value: 'all' },
];

const bucketLabelFormatters: Record<AnalyticsTimeGrain, Intl.DateTimeFormat> = {
  day: new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
  }),
  hour: new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour: 'numeric',
    month: 'short',
  }),
  minute: new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }),
  week: new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
  }),
};

function toSeriesData(
  series: AnalyticsSeriesPoint[],
  grain: AnalyticsTimeGrain,
): AnalyticsSeriesChartPoint[] {
  return series.map((point) => ({
    bucketLabel: bucketLabelFormatters[grain].format(new Date(point.bucketStart)),
    estimatedCostUsd: point.estimatedCostUsd,
    eventCount: point.eventCount,
    inputTokens: point.inputTokens,
    outputTokens: point.outputTokens,
  }));
}

export function parseAnalyticsWindowValue(value: string | null | undefined): AnalyticsWindow | undefined {
  const parsed = analyticsWindowSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function toBreakdownRows(
  rows: Array<{ estimatedCostUsd: number; eventCount: number; model?: string; source?: string }>,
): AnalyticsBreakdownRow[] {
  return rows.map((row) => ({
    estimatedCostLabel: formatCurrency(row.estimatedCostUsd),
    eventCountLabel: formatInteger(row.eventCount),
    label: row.model ?? humanizeEnumValue(row.source ?? 'unknown'),
  }));
}

export function toAnalyticsOverviewViewModel(overview: AnalyticsOverview): AnalyticsOverviewViewModel {
  const hasEvents = overview.totals.eventCount > 0;

  return {
    byModelRows: toBreakdownRows(overview.byModel),
    bySourceRows: toBreakdownRows(overview.bySource),
    eventCountLabel: formatInteger(overview.totals.eventCount),
    hasEvents,
    seriesData: toSeriesData(overview.series, overview.grain),
    topAgentRows: overview.topAgents.map((agent) => ({
      agentId: agent.agentId,
      agentName: agent.agentName,
      estimatedCostLabel: formatCurrency(agent.estimatedCostUsd),
      eventCountLabel: formatInteger(agent.eventCount),
    })),
    totalEstimatedCostLabel: formatCurrency(overview.totals.estimatedCostUsd),
    totalInputTokensLabel: formatInteger(overview.totals.inputTokens),
    totalOutputTokensLabel: formatInteger(overview.totals.outputTokens),
    window: overview.window,
  };
}

export function toAgentAnalyticsViewModel(summary: AnalyticsAgentSummary): AgentAnalyticsViewModel {
  return {
    agentId: summary.agentId,
    agentName: summary.agentName,
    eventCountLabel: formatInteger(summary.totals.eventCount),
    hasEvents: summary.totals.eventCount > 0,
    seriesData: toSeriesData(summary.series, summary.grain),
    totalEstimatedCostLabel: formatCurrency(summary.totals.estimatedCostUsd),
    totalInputTokensLabel: formatInteger(summary.totals.inputTokens),
    totalOutputTokensLabel: formatInteger(summary.totals.outputTokens),
    window: summary.window,
  };
}

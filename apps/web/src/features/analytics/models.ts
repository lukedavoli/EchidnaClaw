import type { AnalyticsOverview } from '@echidna-claw/contracts';

import { formatCurrency, formatInteger } from '../../lib/formatting/numbers.js';
import { humanizeEnumValue } from '../../lib/formatting/status.js';

export type AnalyticsOverviewViewModel = {
  chartData: Array<{
    inputTokens: number;
    outputTokens: number;
    source: string;
  }>;
  eventCountLabel: string;
  hasEvents: boolean;
  totalEstimatedCostLabel: string;
  totalInputTokensLabel: string;
  totalOutputTokensLabel: string;
};

export function toAnalyticsOverviewViewModel(
  overview: AnalyticsOverview,
): AnalyticsOverviewViewModel {
  const buckets = new Map<string, { inputTokens: number; outputTokens: number; source: string }>();

  for (const event of overview.events) {
    const source = humanizeEnumValue(event.source);
    const current = buckets.get(source) ?? {
      inputTokens: 0,
      outputTokens: 0,
      source,
    };

    current.inputTokens += event.tokens.inputTokens;
    current.outputTokens += event.tokens.outputTokens;
    buckets.set(source, current);
  }

  return {
    chartData: Array.from(buckets.values()).sort((left, right) =>
      left.source.localeCompare(right.source),
    ),
    eventCountLabel: formatInteger(overview.events.length),
    hasEvents: overview.events.length > 0,
    totalEstimatedCostLabel: formatCurrency(overview.totalEstimatedCostUsd),
    totalInputTokensLabel: formatInteger(overview.totalInputTokens),
    totalOutputTokensLabel: formatInteger(overview.totalOutputTokens),
  };
}

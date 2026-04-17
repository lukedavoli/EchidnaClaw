import type {
  AnalyticsAgentSummary,
  AnalyticsOverview,
  AnalyticsSeriesPoint,
  AnalyticsSeriesResponse,
  AnalyticsTimeGrain,
  AnalyticsTotals,
  AnalyticsWindow,
  UsageEvent,
} from '@echidna-claw/contracts';

type GroupSlice = {
  estimatedCostUsd: number;
  eventCount: number;
};

type WindowSpec = {
  from: string | null;
  grain: AnalyticsTimeGrain;
  window: AnalyticsWindow;
};

function addDays(date: Date, amount: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function startOfBucket(input: Date, grain: AnalyticsTimeGrain): Date {
  const bucket = new Date(input.getTime());
  bucket.setUTCSeconds(0, 0);

  switch (grain) {
    case 'minute':
      return bucket;
    case 'hour':
      bucket.setUTCMinutes(0, 0, 0);
      return bucket;
    case 'day':
      bucket.setUTCHours(0, 0, 0, 0);
      return bucket;
    case 'week': {
      bucket.setUTCHours(0, 0, 0, 0);
      const day = bucket.getUTCDay();
      const offset = day === 0 ? -6 : 1 - day;
      return addDays(bucket, offset);
    }
  }
}

function stepBucket(input: Date, grain: AnalyticsTimeGrain): Date {
  switch (grain) {
    case 'minute':
      return new Date(input.getTime() + 60_000);
    case 'hour':
      return new Date(input.getTime() + 60 * 60_000);
    case 'day':
      return addDays(input, 1);
    case 'week':
      return addDays(input, 7);
  }
}

function resolveWindow(window: AnalyticsWindow, asOf: string): WindowSpec {
  const end = new Date(asOf);
  switch (window) {
    case '1h':
      return {
        from: new Date(end.getTime() - 60 * 60_000).toISOString(),
        grain: 'minute',
        window,
      };
    case '24h':
      return {
        from: new Date(end.getTime() - 24 * 60 * 60_000).toISOString(),
        grain: 'hour',
        window,
      };
    case '7d':
      return {
        from: new Date(end.getTime() - 7 * 24 * 60 * 60_000).toISOString(),
        grain: 'day',
        window,
      };
    case '30d':
      return {
        from: new Date(end.getTime() - 30 * 24 * 60 * 60_000).toISOString(),
        grain: 'day',
        window,
      };
    case '90d':
      return {
        from: new Date(end.getTime() - 90 * 24 * 60 * 60_000).toISOString(),
        grain: 'week',
        window,
      };
    case 'all':
      return {
        from: null,
        grain: 'week',
        window,
      };
  }
}

function filterEventsForWindow(events: readonly UsageEvent[], spec: WindowSpec): UsageEvent[] {
  const windowStart = spec.from;
  const filtered =
    windowStart == null
      ? [...events]
      : events.filter((event) => event.occurredAt >= windowStart);
  return filtered.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
}

function addNullableInt(current: number | null, next: number | null | undefined): number | null {
  if (next == null) {
    return current;
  }

  return (current ?? 0) + next;
}

function createEmptyTotals(): AnalyticsTotals {
  return {
    estimatedCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: null,
    toolInputTokens: null,
    toolOutputTokens: null,
    eventCount: 0,
  };
}

function summarizeTotals(events: readonly UsageEvent[]): AnalyticsTotals {
  return events.reduce<AnalyticsTotals>((totals, event) => {
    totals.estimatedCostUsd = Number((totals.estimatedCostUsd + event.estimatedCostUsd).toFixed(9));
    totals.inputTokens += event.tokens.inputTokens;
    totals.outputTokens += event.tokens.outputTokens;
    totals.reasoningTokens = addNullableInt(totals.reasoningTokens, event.tokens.reasoningTokens);
    totals.toolInputTokens = addNullableInt(totals.toolInputTokens, event.tokens.toolInputTokens);
    totals.toolOutputTokens = addNullableInt(totals.toolOutputTokens, event.tokens.toolOutputTokens);
    totals.eventCount += 1;
    return totals;
  }, createEmptyTotals());
}

function toSortedGroupEntries<TValue extends GroupSlice & Record<string, unknown>>(
  map: Map<string, TValue>,
): TValue[] {
  return [...map.values()].sort((left, right) => {
    if (right.estimatedCostUsd !== left.estimatedCostUsd) {
      return right.estimatedCostUsd - left.estimatedCostUsd;
    }

    return right.eventCount - left.eventCount;
  });
}

function buildSeries(
  events: readonly UsageEvent[],
  spec: WindowSpec,
  asOf: string,
  maxPoints: number,
): AnalyticsSeriesPoint[] {
  if (events.length === 0) {
    return [];
  }

  const lastEventAt = new Date(asOf);
  const windowStart = spec.from;
  const firstBucketDate =
    windowStart != null
      ? startOfBucket(new Date(windowStart), spec.grain)
      : startOfBucket(new Date(events[0]!.occurredAt), spec.grain);
  const lastBucketDate = startOfBucket(lastEventAt, spec.grain);
  const buckets = new Map<string, AnalyticsSeriesPoint>();

  for (let cursor = firstBucketDate; cursor <= lastBucketDate; cursor = stepBucket(cursor, spec.grain)) {
    const bucketStart = cursor.toISOString();
    buckets.set(bucketStart, {
      bucketStart,
      estimatedCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      eventCount: 0,
    });
  }

  for (const event of events) {
    const bucketStart = startOfBucket(new Date(event.occurredAt), spec.grain).toISOString();
    const bucket = buckets.get(bucketStart);
    if (!bucket) {
      continue;
    }

    bucket.estimatedCostUsd = Number((bucket.estimatedCostUsd + event.estimatedCostUsd).toFixed(9));
    bucket.inputTokens += event.tokens.inputTokens;
    bucket.outputTokens += event.tokens.outputTokens;
    bucket.eventCount += 1;
  }

  const series = [...buckets.values()].sort((left, right) =>
    left.bucketStart.localeCompare(right.bucketStart),
  );

  if (series.length <= maxPoints) {
    return series;
  }

  return series.slice(series.length - maxPoints);
}

export function buildAnalyticsOverview(input: {
  agentNames: Map<string, string>;
  asOf: string;
  events: readonly UsageEvent[];
  includeCompatibilityEvents: boolean;
  maxPoints: number;
  window: AnalyticsWindow;
}): AnalyticsOverview {
  const spec = resolveWindow(input.window, input.asOf);
  const events = filterEventsForWindow(input.events, spec);
  const byModel = new Map<string, { model: string } & GroupSlice>();
  const bySource = new Map<string, { source: string } & GroupSlice>();
  const byAgent = new Map<string, { agentId: string; agentName: string } & GroupSlice>();

  for (const event of events) {
    const modelSlice = byModel.get(event.model) ?? {
      model: event.model,
      estimatedCostUsd: 0,
      eventCount: 0,
    };
    modelSlice.estimatedCostUsd = Number((modelSlice.estimatedCostUsd + event.estimatedCostUsd).toFixed(9));
    modelSlice.eventCount += 1;
    byModel.set(event.model, modelSlice);

    const sourceSlice = bySource.get(event.source) ?? {
      source: event.source,
      estimatedCostUsd: 0,
      eventCount: 0,
    };
    sourceSlice.estimatedCostUsd = Number((sourceSlice.estimatedCostUsd + event.estimatedCostUsd).toFixed(9));
    sourceSlice.eventCount += 1;
    bySource.set(event.source, sourceSlice);

    const agentSlice = byAgent.get(event.agentId) ?? {
      agentId: event.agentId,
      agentName: input.agentNames.get(event.agentId) ?? event.agentId,
      estimatedCostUsd: 0,
      eventCount: 0,
    };
    agentSlice.estimatedCostUsd = Number((agentSlice.estimatedCostUsd + event.estimatedCostUsd).toFixed(9));
    agentSlice.eventCount += 1;
    byAgent.set(event.agentId, agentSlice);
  }

  return {
    window: spec.window,
    grain: spec.grain,
    totals: summarizeTotals(events),
    byModel: toSortedGroupEntries(byModel),
    bySource: toSortedGroupEntries(bySource),
    topAgents: toSortedGroupEntries(byAgent).slice(0, 10),
    series: buildSeries(events, spec, input.asOf, input.maxPoints),
    events: input.includeCompatibilityEvents ? [...events].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)) : [],
  };
}

export function buildAgentAnalyticsSummary(input: {
  agentId: string;
  agentName: string;
  asOf: string;
  events: readonly UsageEvent[];
  includeCompatibilityEvents: boolean;
  maxPoints: number;
  window: AnalyticsWindow;
}): AnalyticsAgentSummary {
  const spec = resolveWindow(input.window, input.asOf);
  const events = filterEventsForWindow(
    input.events.filter((event) => event.agentId === input.agentId),
    spec,
  );
  const byModel = new Map<string, { model: string } & GroupSlice>();
  const bySource = new Map<string, { source: string } & GroupSlice>();

  for (const event of events) {
    const modelSlice = byModel.get(event.model) ?? {
      model: event.model,
      estimatedCostUsd: 0,
      eventCount: 0,
    };
    modelSlice.estimatedCostUsd = Number((modelSlice.estimatedCostUsd + event.estimatedCostUsd).toFixed(9));
    modelSlice.eventCount += 1;
    byModel.set(event.model, modelSlice);

    const sourceSlice = bySource.get(event.source) ?? {
      source: event.source,
      estimatedCostUsd: 0,
      eventCount: 0,
    };
    sourceSlice.estimatedCostUsd = Number((sourceSlice.estimatedCostUsd + event.estimatedCostUsd).toFixed(9));
    sourceSlice.eventCount += 1;
    bySource.set(event.source, sourceSlice);
  }

  return {
    agentId: input.agentId,
    agentName: input.agentName,
    window: spec.window,
    grain: spec.grain,
    totals: summarizeTotals(events),
    byModel: toSortedGroupEntries(byModel),
    bySource: toSortedGroupEntries(bySource),
    series: buildSeries(events, spec, input.asOf, input.maxPoints),
    events: input.includeCompatibilityEvents ? [...events].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)) : [],
  };
}

export function buildAnalyticsSeries(input: {
  asOf: string;
  events: readonly UsageEvent[];
  maxPoints: number;
  window: AnalyticsWindow;
  agentId?: string;
}): AnalyticsSeriesResponse {
  const spec = resolveWindow(input.window, input.asOf);
  const filteredEvents = input.agentId
    ? input.events.filter((event) => event.agentId === input.agentId)
    : input.events;

  return {
    ...(input.agentId ? { agentId: input.agentId } : {}),
    window: spec.window,
    grain: spec.grain,
    series: buildSeries(filterEventsForWindow(filteredEvents, spec), spec, input.asOf, input.maxPoints),
  };
}

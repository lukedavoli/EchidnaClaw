import type { AnalyticsWindow } from '@echidna-claw/contracts';
import { Card, Group, SimpleGrid, Skeleton, Stack, Text } from '@mantine/core';
import { Link } from 'react-router-dom';

import type { ApiClientError } from '../../../lib/api/errors.js';
import {
  isApiClientError,
  isDependencyUnavailableError,
  isReservedApiError,
} from '../../../lib/api/errors.js';
import { ErrorPanel } from '../../shell/components/error-panel.js';
import { AnalyticsSeriesChart } from '../../analytics/components/analytics-series-chart.js';
import { AnalyticsWindowControl } from '../../analytics/components/analytics-window-control.js';
import type { AgentAnalyticsViewModel } from '../../analytics/models.js';

type AgentUsagePanelProps = {
  analytics: AgentAnalyticsViewModel | null;
  error: ApiClientError | null;
  loading: boolean;
  onWindowChange: (window: AnalyticsWindow) => void;
  selectedWindow: AnalyticsWindow;
};

function UsageSkeleton() {
  return (
    <Stack gap="md">
      <Skeleton height={96} radius="lg" />
      <Skeleton height={220} radius="lg" />
    </Stack>
  );
}

const metricDefinitions = [
  {
    key: 'totalEstimatedCostLabel',
    label: 'Estimated cost',
  },
  {
    key: 'totalInputTokensLabel',
    label: 'Input tokens',
  },
  {
    key: 'totalOutputTokensLabel',
    label: 'Output tokens',
  },
  {
    key: 'eventCountLabel',
    label: 'Events',
  },
] as const;

export function AgentUsagePanel({
  analytics,
  error,
  loading,
  onWindowChange,
  selectedWindow,
}: AgentUsagePanelProps) {
  return (
    <Card className="shell-surface shell-surface--strong" padding="lg" radius="xl" withBorder>
      <Stack gap="lg">
        <Group align="flex-start" justify="space-between" wrap="wrap">
          <Stack gap={2}>
            <Text fw={700} size="lg">
              Recent usage
            </Text>
            <Text c="dimmed" size="sm">
              Aggregate usage for this agent only, with the same window semantics as the global
              analytics page.
            </Text>
          </Stack>
          <AnalyticsWindowControl onChange={onWindowChange} value={selectedWindow} />
        </Group>

        {loading ? <UsageSkeleton /> : null}

        {!loading && error && isReservedApiError(error) ? (
          <ErrorPanel
            description="Per-agent analytics are reserved by the backend for this environment."
            title="Agent analytics are reserved"
            tone="info"
            traceId={error.traceId}
          />
        ) : null}

        {!loading && error && isDependencyUnavailableError(error) ? (
          <ErrorPanel
            description="Analytics dependencies are unavailable right now. Use refresh once the backing services recover."
            title="Agent analytics are temporarily unavailable"
            tone="warning"
            traceId={error.traceId}
          />
        ) : null}

        {!loading &&
        error &&
        !isReservedApiError(error) &&
        !isDependencyUnavailableError(error) ? (
          <ErrorPanel
            description={error.message}
            title="The recent-usage panel failed to load"
            traceId={isApiClientError(error) ? error.traceId : null}
          />
        ) : null}

        {!loading && !error && analytics && !analytics.hasEvents ? (
          <Text c="dimmed" size="sm">
            No usage events were recorded for this agent in the selected window yet.
          </Text>
        ) : null}

        {!loading && !error && analytics && analytics.hasEvents ? (
          <>
            <SimpleGrid cols={{ base: 2, xl: 4 }} spacing="md">
              {metricDefinitions.map((metric) => (
                <Stack gap={2} key={metric.key}>
                  <Text c="dimmed" size="xs" tt="uppercase">
                    {metric.label}
                  </Text>
                  <Text fw={700} size="lg">
                    {analytics[metric.key]}
                  </Text>
                </Stack>
              ))}
            </SimpleGrid>

            <AnalyticsSeriesChart
              data={analytics.seriesData}
              description="Input and output token activity for this agent across the selected window."
              title="Usage over time"
            />

            <Text
              c="dimmed"
              component={Link}
              size="sm"
              style={{ alignSelf: 'flex-start', textDecoration: 'none' }}
              to={`/analytics?window=${analytics.window}`}
            >
              Open global analytics for wider investigation
            </Text>
          </>
        ) : null}
      </Stack>
    </Card>
  );
}

import type { AnalyticsWindow } from '@echidna-claw/contracts';
import { Card, SimpleGrid, Stack } from '@mantine/core';
import { useSearchParams } from 'react-router-dom';

import {
  isApiClientError,
  isDependencyUnavailableError,
  isReservedApiError,
} from '../../../lib/api/errors.js';
import { ErrorPanel } from '../../shell/components/error-panel.js';
import { PageHeader } from '../../shell/components/page-header.js';
import { RefreshButton } from '../../shell/components/refresh-button.js';
import { AnalyticsBreakdownTable } from '../components/analytics-breakdown-table.js';
import { AnalyticsEmptyState } from '../components/analytics-empty-state.js';
import { AnalyticsSeriesChart } from '../components/analytics-series-chart.js';
import { AnalyticsSummaryCards } from '../components/analytics-summary-cards.js';
import { AnalyticsTopAgentsTable } from '../components/analytics-top-agents-table.js';
import { AnalyticsWindowControl } from '../components/analytics-window-control.js';
import { useAnalyticsOverviewQuery } from '../hooks.js';
import { parseAnalyticsWindowValue, toAnalyticsOverviewViewModel } from '../models.js';

export function AnalyticsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedWindow = parseAnalyticsWindowValue(searchParams.get('window'));
  const analyticsQuery = useAnalyticsOverviewQuery(requestedWindow);
  const overview = analyticsQuery.data ? toAnalyticsOverviewViewModel(analyticsQuery.data) : null;
  const selectedWindow = overview?.window ?? requestedWindow ?? '30d';

  function setWindow(window: AnalyticsWindow) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('window', window);
      return next;
    });
  }

  return (
    <Stack gap="xl">
      <PageHeader
        actions={
          <RefreshButton
            onClick={() => {
              void analyticsQuery.refetch();
            }}
            refreshing={analyticsQuery.isFetching && !analyticsQuery.isLoading}
          />
        }
        description="Global aggregate usage for the control plane, with backend-driven windows, series, grouped breakdowns, and per-agent drill-down links."
        title="Analytics"
      />

      <AnalyticsWindowControl onChange={setWindow} value={selectedWindow} />

      {analyticsQuery.error && isReservedApiError(analyticsQuery.error) ? (
        <ErrorPanel
          actionLabel="Retry analytics"
          description="The analytics route exists, but the backend overview remains reserved in this environment."
          onAction={() => {
            void analyticsQuery.refetch();
          }}
          title="Analytics are reserved in the backend"
          tone="info"
          traceId={isApiClientError(analyticsQuery.error) ? analyticsQuery.error.traceId : null}
        />
      ) : null}

      {analyticsQuery.error && isDependencyUnavailableError(analyticsQuery.error) ? (
        <ErrorPanel
          actionLabel="Retry analytics"
          description="Analytics dependencies are currently unavailable, so the shell is preserving the page frame and waiting for an explicit retry."
          onAction={() => {
            void analyticsQuery.refetch();
          }}
          title="Analytics dependencies are unavailable"
          tone="warning"
          traceId={isApiClientError(analyticsQuery.error) ? analyticsQuery.error.traceId : null}
        />
      ) : null}

      {analyticsQuery.error &&
      !isReservedApiError(analyticsQuery.error) &&
      !isDependencyUnavailableError(analyticsQuery.error) ? (
        <ErrorPanel
          actionLabel="Retry analytics"
          description={
            isApiClientError(analyticsQuery.error)
              ? analyticsQuery.error.message
              : 'The analytics overview failed to load.'
          }
          onAction={() => {
            void analyticsQuery.refetch();
          }}
          title="The analytics page failed to load"
          traceId={isApiClientError(analyticsQuery.error) ? analyticsQuery.error.traceId : null}
        />
      ) : null}

      {overview ? (
        <>
          <AnalyticsSummaryCards overview={overview} />
          {overview.hasEvents ? (
            <>
              <Card
                className="shell-surface shell-surface--strong"
                padding="lg"
                radius="xl"
                withBorder
              >
                <AnalyticsSeriesChart
                  data={overview.seriesData}
                  description="Primary time-series view of input and output token activity for the selected window."
                  title="Usage over time"
                />
              </Card>

              <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
                <AnalyticsBreakdownTable
                  emptyMessage="No source usage is available for the selected window."
                  rowLabel="Source"
                  rows={overview.bySourceRows}
                  title="Usage by source"
                />
                <AnalyticsBreakdownTable
                  emptyMessage="No model usage is available for the selected window."
                  rowLabel="Model"
                  rows={overview.byModelRows}
                  title="Usage by model"
                />
              </SimpleGrid>

              <AnalyticsTopAgentsTable rows={overview.topAgentRows} />
            </>
          ) : (
            <AnalyticsEmptyState />
          )}
        </>
      ) : null}
    </Stack>
  );
}

import { Stack } from '@mantine/core';

import {
  isApiClientError,
  isDependencyUnavailableError,
  isReservedApiError,
} from '../../../lib/api/errors.js';
import { ErrorPanel } from '../../shell/components/error-panel.js';
import { PageHeader } from '../../shell/components/page-header.js';
import { RefreshButton } from '../../shell/components/refresh-button.js';
import { AnalyticsEmptyState } from '../components/analytics-empty-state.js';
import { AnalyticsSummaryCards } from '../components/analytics-summary-cards.js';
import { UsageOverviewChart } from '../components/usage-overview-chart.js';
import { useAnalyticsOverviewQuery } from '../hooks.js';
import { toAnalyticsOverviewViewModel } from '../models.js';

export function AnalyticsPage() {
  const analyticsQuery = useAnalyticsOverviewQuery();
  const overview = analyticsQuery.data ? toAnalyticsOverviewViewModel(analyticsQuery.data) : null;

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
        description="Overview metrics and a first chart surface for usage analytics, with deliberate empty and unavailable states while the backend aggregates remain partial."
        title="Analytics"
      />

      {analyticsQuery.error && isReservedApiError(analyticsQuery.error) ? (
        <ErrorPanel
          actionLabel="Retry analytics"
          description="The analytics route exists, but the backend overview remains reserved. The chart and KPI surfaces are in place and waiting for Step 18 data."
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
          {overview.hasEvents ? <UsageOverviewChart overview={overview} /> : <AnalyticsEmptyState />}
        </>
      ) : null}
    </Stack>
  );
}

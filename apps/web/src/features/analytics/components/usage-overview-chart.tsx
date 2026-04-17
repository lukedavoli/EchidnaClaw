import { Card } from '@mantine/core';

import type { AnalyticsOverviewViewModel } from '../models.js';
import { AnalyticsSeriesChart } from './analytics-series-chart.js';

type UsageOverviewChartProps = {
  overview: AnalyticsOverviewViewModel;
};

export function UsageOverviewChart({ overview }: UsageOverviewChartProps) {
  return (
    <Card className="shell-surface shell-surface--strong" padding="lg" radius="xl" withBorder>
      <AnalyticsSeriesChart
        data={overview.seriesData}
        description="Primary time-series view of input and output token activity for the selected window."
        title="Usage over time"
      />
    </Card>
  );
}

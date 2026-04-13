import { BarChart } from '@mantine/charts';
import { Card, Stack, Text } from '@mantine/core';

import type { AnalyticsOverviewViewModel } from '../models.js';

type UsageOverviewChartProps = {
  overview: AnalyticsOverviewViewModel;
};

export function UsageOverviewChart({ overview }: UsageOverviewChartProps) {
  return (
    <Card className="shell-surface shell-surface--strong" padding="lg" radius="xl" withBorder>
      <Stack gap="md">
        <Stack gap={2}>
          <Text fw={700} size="lg">
            Usage by source
          </Text>
          <Text c="dimmed" size="sm">
            Library-backed chart surface reserved for the richer Step 18 aggregates.
          </Text>
        </Stack>

        <BarChart
          data={overview.chartData}
          dataKey="source"
          h={320}
          series={[
            {
              color: 'teal.6',
              name: 'inputTokens',
            },
            {
              color: 'orange.6',
              name: 'outputTokens',
            },
          ]}
          tickLine="y"
          withLegend
        />
      </Stack>
    </Card>
  );
}

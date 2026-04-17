import { BarChart } from '@mantine/charts';
import { Stack, Text } from '@mantine/core';

import type { AnalyticsSeriesChartPoint } from '../models.js';

type AnalyticsSeriesChartProps = {
  data: AnalyticsSeriesChartPoint[];
  description: string;
  height?: number;
  title: string;
};

export function AnalyticsSeriesChart({
  data,
  description,
  height = 320,
  title,
}: AnalyticsSeriesChartProps) {
  return (
    <Stack gap="md">
      <Stack gap={2}>
        <Text fw={700} size="lg">
          {title}
        </Text>
        <Text c="dimmed" size="sm">
          {description}
        </Text>
      </Stack>

      <BarChart
        data={data}
        dataKey="bucketLabel"
        h={height}
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
  );
}

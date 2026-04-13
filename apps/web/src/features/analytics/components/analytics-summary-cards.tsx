import { Card, SimpleGrid, Stack, Text } from '@mantine/core';

import type { AnalyticsOverviewViewModel } from '../models.js';

type AnalyticsSummaryCardsProps = {
  overview: AnalyticsOverviewViewModel;
};

const metricDefinitions = [
  {
    description: 'Approximate cost from usage events.',
    key: 'totalEstimatedCostLabel',
    label: 'Estimated cost',
  },
  {
    description: 'Total input tokens across recorded events.',
    key: 'totalInputTokensLabel',
    label: 'Input tokens',
  },
  {
    description: 'Total output tokens across recorded events.',
    key: 'totalOutputTokensLabel',
    label: 'Output tokens',
  },
  {
    description: 'Events currently represented in the overview.',
    key: 'eventCountLabel',
    label: 'Events',
  },
] as const;

export function AnalyticsSummaryCards({ overview }: AnalyticsSummaryCardsProps) {
  return (
    <SimpleGrid cols={{ base: 1, md: 2, xl: 4 }} spacing="md">
      {metricDefinitions.map((metric) => (
        <Card
          className="shell-surface shell-surface--strong metric-card"
          key={metric.key}
          padding="lg"
          radius="xl"
          withBorder
        >
          <Stack gap="sm">
            <Text className="metric-card__label">{metric.label}</Text>
            <Text className="metric-card__value">{overview[metric.key]}</Text>
            <Text className="metric-card__description">{metric.description}</Text>
          </Stack>
        </Card>
      ))}
    </SimpleGrid>
  );
}

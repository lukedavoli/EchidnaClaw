import { Card, Table, Text } from '@mantine/core';

import type { AnalyticsBreakdownRow } from '../models.js';

type AnalyticsBreakdownTableProps = {
  emptyMessage: string;
  rowLabel: string;
  rows: AnalyticsBreakdownRow[];
  title: string;
};

export function AnalyticsBreakdownTable({
  emptyMessage,
  rowLabel,
  rows,
  title,
}: AnalyticsBreakdownTableProps) {
  return (
    <Card className="shell-surface shell-surface--strong" padding="lg" radius="xl" withBorder>
      <Text fw={700} size="lg">
        {title}
      </Text>

      {rows.length === 0 ? (
        <Text c="dimmed" mt="md" size="sm">
          {emptyMessage}
        </Text>
      ) : (
        <Table mt="md" striped withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{rowLabel}</Table.Th>
              <Table.Th>Events</Table.Th>
              <Table.Th>Estimated cost</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => (
              <Table.Tr key={row.label}>
                <Table.Td>{row.label}</Table.Td>
                <Table.Td>{row.eventCountLabel}</Table.Td>
                <Table.Td>{row.estimatedCostLabel}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Card>
  );
}

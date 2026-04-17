import { Anchor, Card, Table, Text } from '@mantine/core';
import { Link } from 'react-router-dom';

import type { AnalyticsTopAgentRow } from '../models.js';

type AnalyticsTopAgentsTableProps = {
  rows: AnalyticsTopAgentRow[];
};

export function AnalyticsTopAgentsTable({ rows }: AnalyticsTopAgentsTableProps) {
  return (
    <Card className="shell-surface shell-surface--strong" padding="lg" radius="xl" withBorder>
      <Text fw={700} size="lg">
        Top agents
      </Text>

      {rows.length === 0 ? (
        <Text c="dimmed" mt="md" size="sm">
          No agent usage was recorded in the selected window.
        </Text>
      ) : (
        <Table mt="md" striped withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Agent</Table.Th>
              <Table.Th>Events</Table.Th>
              <Table.Th>Estimated cost</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => (
              <Table.Tr key={row.agentId}>
                <Table.Td>
                  <Anchor component={Link} to={`/agents/${row.agentId}`}>
                    {row.agentName}
                  </Anchor>
                </Table.Td>
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

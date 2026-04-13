import { Button, Card, Group, Stack, Text, Tooltip } from '@mantine/core';

import { formatDateTime } from '../../../lib/formatting/dates.js';
import { AgentStatusBadges } from './agent-status-badges.js';
import type { AgentViewModel } from '../models.js';

type AgentCardProps = {
  agent: AgentViewModel;
  busy: boolean;
  onArchive: (agent: AgentViewModel) => void;
  onRestore: (agent: AgentViewModel) => void;
};

export function AgentCard({ agent, busy, onArchive, onRestore }: AgentCardProps) {
  return (
    <Card className="shell-surface shell-surface--strong" padding="lg" radius="xl" withBorder>
      <Stack gap="lg">
        <Stack gap="xs">
          <Group align="flex-start" justify="space-between" wrap="wrap">
            <Stack gap={2}>
              <Text fw={700} size="lg">
                {agent.name}
              </Text>
              <Text c="dimmed" size="sm">
                {agent.timeZone} · {agent.headModel}
              </Text>
            </Stack>
            <AgentStatusBadges agent={agent} />
          </Group>
          <Text c="dimmed" size="sm">
            Created {formatDateTime(agent.createdAt)} · Updated {formatDateTime(agent.updatedAt)}
          </Text>
        </Stack>

        <Group wrap="wrap">
          {agent.isArchived ? (
            <Button color="teal" loading={busy} onClick={() => onRestore(agent)} variant="light">
              Restore
            </Button>
          ) : (
            <Button color="red" loading={busy} onClick={() => onArchive(agent)} variant="light">
              Archive
            </Button>
          )}

          <Tooltip label={agent.reservedRetryReason}>
            <span>
              <Button disabled variant="default">
                Retry provisioning
              </Button>
            </span>
          </Tooltip>

          <Tooltip label={agent.reservedConversationReason}>
            <span>
              <Button disabled variant="subtle">
                Jump to conversation
              </Button>
            </span>
          </Tooltip>
        </Group>
      </Stack>
    </Card>
  );
}

import { Button, Card, Group, Stack, Text, Tooltip } from '@mantine/core';

import { formatDateTime } from '../../../lib/formatting/dates.js';
import type { AgentViewModel } from '../models.js';
import { AgentStatusBadges } from './agent-status-badges.js';

type AgentCardProps = {
  agent: AgentViewModel;
  busy: boolean;
  onArchive: (agent: AgentViewModel) => void;
  onRetry: (agent: AgentViewModel) => void;
  onRestore: (agent: AgentViewModel) => void;
};

export function AgentCard({ agent, busy, onArchive, onRetry, onRestore }: AgentCardProps) {
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
                {agent.timeZone} - {agent.headModel}
              </Text>
            </Stack>
            <AgentStatusBadges agent={agent} />
          </Group>
          <Text c="dimmed" size="sm">
            Created {formatDateTime(agent.createdAt)} - Updated {formatDateTime(agent.updatedAt)}
          </Text>
          {agent.botIdentity ? <Text size="sm">Bot identity: {agent.botIdentity}</Text> : null}
          {agent.lastProvisioningErrorMessage ? (
            <Text c="red" size="sm">
              Last provisioning error: {agent.lastProvisioningErrorMessage}
            </Text>
          ) : null}
          {agent.recoverySummary ? (
            <Text c="dimmed" size="sm">
              {agent.recoverySummary}
            </Text>
          ) : null}
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

          <Tooltip label={agent.retryProvisioningReason}>
            <span>
              <Button
                disabled={!agent.canRetryProvisioning || busy}
                loading={busy && agent.canRetryProvisioning}
                onClick={() => onRetry(agent)}
                variant="default"
              >
                Retry provisioning
              </Button>
            </span>
          </Tooltip>

          {agent.conversationUrl ? (
            <Button component="a" href={agent.conversationUrl} rel="noreferrer" target="_blank" variant="subtle">
              Jump to conversation
            </Button>
          ) : (
            <Tooltip label={agent.conversationReason}>
              <span>
                <Button disabled variant="subtle">
                  Jump to conversation
                </Button>
              </span>
            </Tooltip>
          )}
        </Group>
      </Stack>
    </Card>
  );
}

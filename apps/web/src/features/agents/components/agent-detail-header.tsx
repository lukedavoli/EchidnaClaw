import { Alert, Button, Card, Group, Stack, Text, Tooltip } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { Link } from 'react-router-dom';

import { formatDateTime } from '../../../lib/formatting/dates.js';
import type { AgentViewModel } from '../models.js';
import { AgentStatusBadges } from './agent-status-badges.js';

type AgentDetailHeaderProps = {
  agent: AgentViewModel;
  busy: boolean;
  onArchive: () => void;
  onRestore: () => void;
  onRetry: () => void;
};

export function AgentDetailHeader({
  agent,
  busy,
  onArchive,
  onRestore,
  onRetry,
}: AgentDetailHeaderProps) {
  const backTo = agent.isArchived ? '/agents?view=archived' : '/agents';

  return (
    <Card className="shell-surface shell-surface--strong" padding="lg" radius="xl" withBorder>
      <Stack gap="lg">
        <Group align="flex-start" justify="space-between" wrap="wrap">
          <Stack gap="xs">
            <Button component={Link} leftSection={<IconArrowLeft size={16} />} to={backTo} variant="subtle">
              Back to agents
            </Button>
            <Stack gap={2}>
              <Text fw={700} size="xl">
                {agent.name}
              </Text>
              <Text c="dimmed" size="sm">
                {agent.timeZone} - {agent.headModel}
              </Text>
            </Stack>
            <Text c="dimmed" size="sm">
              Created {formatDateTime(agent.createdAt)} - Updated {formatDateTime(agent.updatedAt)}
            </Text>
            {agent.botIdentity ? <Text size="sm">Bot identity: {agent.botIdentity}</Text> : null}
          </Stack>
          <AgentStatusBadges agent={agent} />
        </Group>

        {agent.isArchived ? (
          <Alert color="gray" radius="lg" variant="light">
            This agent is archived. Restore it before resuming Telegram operations or opening the
            conversation.
          </Alert>
        ) : null}

        <Group wrap="wrap">
          {agent.isArchived ? (
            <Button color="teal" loading={busy} onClick={onRestore} variant="light">
              Restore
            </Button>
          ) : (
            <Button color="red" loading={busy} onClick={onArchive} variant="light">
              Archive
            </Button>
          )}

          <Tooltip label={agent.retryProvisioningReason}>
            <span>
              <Button
                disabled={!agent.canRetryProvisioning || busy}
                loading={busy && agent.canRetryProvisioning}
                onClick={onRetry}
                variant="default"
              >
                Retry provisioning
              </Button>
            </span>
          </Tooltip>

          {agent.conversationUrl ? (
            <Button component="a" href={agent.conversationUrl} rel="noreferrer" target="_blank">
              Jump to conversation
            </Button>
          ) : (
            <Tooltip label={agent.conversationReason}>
              <span>
                <Button disabled>Jump to conversation</Button>
              </span>
            </Tooltip>
          )}
        </Group>
      </Stack>
    </Card>
  );
}

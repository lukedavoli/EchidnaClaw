import { Badge, Card, SimpleGrid, Stack, Text } from '@mantine/core';

import type { AgentDetailField, AgentDetailViewModel } from '../models.js';

function DetailFieldList({
  fields,
  title,
}: {
  fields: AgentDetailField[];
  title: string;
}) {
  return (
    <Stack gap="sm">
      <Text fw={600} size="sm">
        {title}
      </Text>
      {fields.map((field) => (
        <Stack gap={2} key={field.label}>
          <Text c="dimmed" size="xs" tt="uppercase">
            {field.label}
          </Text>
          <Text
            {...(field.tone === 'danger'
              ? { c: 'red' as const }
              : field.tone === 'muted'
                ? { c: 'dimmed' as const }
                : {})}
            {...(field.monospace ? { ff: 'monospace' as const } : {})}
            size="sm"
          >
            {field.value}
          </Text>
        </Stack>
      ))}
    </Stack>
  );
}

type AgentChannelPanelProps = {
  agent: AgentDetailViewModel;
};

export function AgentChannelPanel({ agent }: AgentChannelPanelProps) {
  return (
    <Card className="shell-surface shell-surface--strong" padding="lg" radius="xl" withBorder>
      <Stack gap="lg">
        <Stack gap={2}>
          <Text fw={700} size="lg">
            Telegram channel status
          </Text>
          <Text c="dimmed" size="sm">
            Read-only channel identity, provisioning timestamps, and credential-binding status.
          </Text>
        </Stack>

        <Badge color={agent.credentialStatusBadgeTone} radius="sm" variant="light" w="fit-content">
          {agent.credentialStatusLabel}
        </Badge>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
          <DetailFieldList fields={agent.channelIdentityFields} title="Identity and binding" />
          <DetailFieldList fields={agent.lifecycleTimelineFields} title="Provisioning timeline" />
        </SimpleGrid>
      </Stack>
    </Card>
  );
}

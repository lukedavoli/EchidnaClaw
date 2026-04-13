import { Badge, Group } from '@mantine/core';

import type { AgentViewModel } from '../models.js';

type AgentStatusBadgesProps = {
  agent: AgentViewModel;
};

export function AgentStatusBadges({ agent }: AgentStatusBadgesProps) {
  return (
    <Group gap="xs">
      <Badge color={agent.provisioningTone} variant="light">
        Provisioning: {agent.provisioningLabel}
      </Badge>
      <Badge color={agent.lifecycleTone} variant="dot">
        Lifecycle: {agent.lifecycleLabel}
      </Badge>
    </Group>
  );
}

import { Stack } from '@mantine/core';

import type { AgentViewModel } from '../models.js';
import { AgentCard } from './agent-card.js';

type AgentListProps = {
  agents: AgentViewModel[];
  busyAgentId: string | null;
  onArchive: (agent: AgentViewModel) => void;
  onRestore: (agent: AgentViewModel) => void;
};

export function AgentList({ agents, busyAgentId, onArchive, onRestore }: AgentListProps) {
  return (
    <Stack gap="md">
      {agents.map((agent) => (
        <AgentCard
          agent={agent}
          busy={busyAgentId === agent.id}
          key={agent.id}
          onArchive={onArchive}
          onRestore={onRestore}
        />
      ))}
    </Stack>
  );
}

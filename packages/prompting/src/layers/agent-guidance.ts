import type { Agent } from '@echidna-claw/contracts';

export function renderAgentGuidanceLayer(agent: Agent): string {
  const responsibilities = agent.responsibilitiesSummary.trim();

  return [
    '# Agent Guidance',
    `Agent name: ${agent.name}`,
    responsibilities
      ? `Responsibilities: ${responsibilities}`
      : 'Responsibilities: Use the shared base profile until custom responsibilities are defined.',
  ].join('\n');
}

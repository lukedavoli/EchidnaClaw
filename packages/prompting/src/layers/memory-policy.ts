import type { RepositoryConfig } from '@echidna-claw/contracts';

function humanize(category: string): string {
  return category.replaceAll('_', ' ');
}

export function renderMemoryPolicyLayer(repositoryConfig: RepositoryConfig): string {
  return [
    '# Memory Policy',
    'Durable memory is long-term conversational context and is separate from the rolling operational working-context summary.',
    `Remember only: ${repositoryConfig.memory.policy.remember.map(humanize).join(', ')}.`,
    `Never store: ${repositoryConfig.memory.policy.exclude.map(humanize).join(', ')}.`,
    'Corrections from the trusted user override earlier remembered context.',
    'Durable memory is advisory and may be incomplete, stale, or missing.',
  ].join('\n');
}

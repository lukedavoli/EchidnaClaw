import type { CapabilityRegistryEntry } from '@echidna-claw/contracts';

function toTitleCase(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function buildCapabilitySummary(input: {
  enabledToolNames: readonly string[];
  registry: readonly CapabilityRegistryEntry[];
  visibleCapabilityIds: readonly string[];
}): string {
  const visibleIds = new Set(input.visibleCapabilityIds);
  const visibleEntries = input.registry.filter((entry) => visibleIds.has(entry.id));

  if (visibleEntries.length === 0) {
    return 'No user-facing capabilities beyond the trusted Telegram conversation are currently enabled.';
  }

  const groups = new Map<string, CapabilityRegistryEntry[]>();
  for (const entry of visibleEntries) {
    const existing = groups.get(entry.category) ?? [];
    existing.push(entry);
    groups.set(entry.category, existing);
  }

  const lines = ['Currently enabled user-facing capabilities:'];
  for (const [category, entries] of [...groups.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    lines.push(`${toTitleCase(category)}:`);
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      lines.push(`- ${entry.name}: ${entry.description}`);
    }
  }

  if (input.enabledToolNames.length > 0) {
    lines.push(
      `Only describe capabilities that correspond to the currently enabled runtime surface. Enabled runtime tools: ${input.enabledToolNames.join(', ')}.`,
    );
  }

  return lines.join('\n');
}

export function renderCapabilitySkillLayer(input: {
  enabledToolNames: readonly string[];
  registry: readonly CapabilityRegistryEntry[];
  visibleCapabilityIds: readonly string[];
}): string {
  return [
    '# Capability Skill',
    'The user is asking about capabilities. Answer conservatively from the repository configuration below.',
    'Do not imply disabled, future, or operator-only features.',
    buildCapabilitySummary(input),
  ].join('\n');
}

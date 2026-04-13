import type { CapabilityRegistryEntry } from '@echidna-claw/contracts';
import { buildCapabilitySummary } from '@echidna-claw/prompting';

export function handleDescribeCapabilities(input: {
  enabledToolNames: readonly string[];
  registry: readonly CapabilityRegistryEntry[];
  visibleCapabilityIds: readonly string[];
}): string {
  return buildCapabilitySummary({
    enabledToolNames: input.enabledToolNames,
    registry: input.registry,
    visibleCapabilityIds: input.visibleCapabilityIds,
  });
}

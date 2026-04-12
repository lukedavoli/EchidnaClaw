export const testingPlaceholder = 'testing' as const;

export function withEnv(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
  return overrides;
}

export const observabilityPlaceholder = 'observability' as const;

export function formatLogLine(scope: string, message: string): string {
  return `[${scope}] ${message}`;
}

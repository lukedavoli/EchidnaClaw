import { Stack, Text } from '@mantine/core';

import { useReadinessQuery } from '../../agents/hooks.js';
import { isApiClientError } from '../../../lib/api/errors.js';
import { ErrorPanel } from './error-panel.js';

export function ReadinessBanner() {
  const readinessQuery = useReadinessQuery();

  if (readinessQuery.isLoading || (readinessQuery.data && readinessQuery.data.status === 'ready')) {
    return null;
  }

  if (readinessQuery.error && isApiClientError(readinessQuery.error)) {
    return (
      <ErrorPanel
        actionLabel="Retry readiness"
        description={readinessQuery.error.message}
        onAction={() => {
          void readinessQuery.refetch();
        }}
        title="The control plane cannot confirm API readiness"
        tone="warning"
        traceId={readinessQuery.error.traceId}
      />
    );
  }

  if (!readinessQuery.data) {
    return null;
  }

  const dependencies = readinessQuery.data.dependencies as Record<
    string,
    { description: string; mode: string; ready: boolean }
  >;
  const blockedDependencies = Object.entries(dependencies).filter(
    ([, dependency]) => !dependency.ready,
  );

  return (
    <ErrorPanel
      actionLabel="Retry readiness"
      description={
        <Stack gap={4}>
          <Text>
            The API is running, but one or more dependencies are not ready for operator traffic yet.
          </Text>
          {blockedDependencies.map(([name, dependency]) => (
            <Text key={name} size="sm">
              {name}: {dependency.description}
            </Text>
          ))}
        </Stack>
      }
      onAction={() => {
        void readinessQuery.refetch();
      }}
      title="API dependencies are still warming up"
      tone="warning"
    />
  );
}

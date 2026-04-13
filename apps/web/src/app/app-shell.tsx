import { AppShell, Badge, Box, Group, Stack, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { Outlet, isRouteErrorResponse, useRouteError } from 'react-router-dom';

import { AppNav } from '../features/shell/components/app-nav.js';
import { EmptyState } from '../features/shell/components/empty-state.js';
import { PageFrame } from '../features/shell/components/page-frame.js';
import { ReadinessBanner } from '../features/shell/components/readiness-banner.js';
import { webConfig } from './runtime.js';

function ShellFrame({ children }: { children: ReactNode }) {
  return (
    <AppShell
      className="control-shell"
      header={{ height: 96 }}
      padding="lg"
    >
      <AppShell.Header className="control-shell__header">
        <PageFrame>
          <Group justify="space-between" wrap="wrap">
            <Stack gap={4}>
              <Group gap="sm">
                <Text className="control-shell__eyebrow">Web Control Plane</Text>
                <Badge color="orange" variant="light">
                  {webConfig.runtimeMode}
                </Badge>
              </Group>
              <Text className="control-shell__title">{webConfig.appTitle}</Text>
            </Stack>
            <AppNav />
          </Group>
        </PageFrame>
      </AppShell.Header>

      <AppShell.Main>
        <PageFrame>
          <Stack gap="lg">
            <ReadinessBanner />
            {children}
          </Stack>
        </PageFrame>
      </AppShell.Main>
    </AppShell>
  );
}

export function AppShellRoute() {
  return (
    <ShellFrame>
      <Outlet />
    </ShellFrame>
  );
}

export function AppRouteErrorBoundary() {
  const error = useRouteError();
  const description = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'The route failed before the control plane could finish rendering.';

  return (
    <ShellFrame>
      <Box py="xl">
        <EmptyState
          actionLabel="Return to agents"
          actionTo="/agents"
          description={description}
          title="This route failed to load"
        />
      </Box>
    </ShellFrame>
  );
}

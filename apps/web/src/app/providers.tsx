import { MantineProvider, createTheme } from '@mantine/core';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { Notifications } from '@mantine/notifications';
import type { PropsWithChildren } from 'react';

const theme = createTheme({
  fontFamily: 'var(--font-body)',
  headings: {
    fontFamily: 'var(--font-heading)',
  },
  primaryColor: 'teal',
  defaultRadius: 'md',
});

type AppProvidersProps = PropsWithChildren<{
  queryClient: QueryClient;
}>;

export function AppProviders({ children, queryClient }: AppProvidersProps) {
  return (
    <MantineProvider defaultColorScheme="light" theme={theme}>
      <QueryClientProvider client={queryClient}>
        {children}
        <Notifications position="top-right" />
      </QueryClientProvider>
    </MantineProvider>
  );
}

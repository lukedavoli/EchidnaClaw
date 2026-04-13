import type { RouteObject } from 'react-router-dom';
import { Navigate, createBrowserRouter, createMemoryRouter } from 'react-router-dom';

import { AnalyticsPage } from '../features/analytics/routes/analytics-page.js';
import { AgentsPage } from '../features/agents/routes/agents-page.js';
import { CreateAgentPage } from '../features/agents/routes/create-agent-page.js';
import { EmptyState } from '../features/shell/components/empty-state.js';
import { AppRouteErrorBoundary, AppShellRoute } from './app-shell.js';

function NotFoundPage() {
  return (
    <EmptyState
      actionLabel="Return to agents"
      actionTo="/agents"
      description="The route you requested is not part of the Step 7 control plane shell yet."
      title="Page not found"
    />
  );
}

const routes: RouteObject[] = [
  {
    element: <AppShellRoute />,
    errorElement: <AppRouteErrorBoundary />,
    path: '/',
    children: [
      {
        index: true,
        element: (
          <Navigate
            replace
            to="/agents"
          />
        ),
      },
      {
        element: <AgentsPage />,
        path: 'agents',
      },
      {
        element: <CreateAgentPage />,
        path: 'agents/new',
      },
      {
        element: <AnalyticsPage />,
        path: 'analytics',
      },
      {
        element: <NotFoundPage />,
        path: '*',
      },
    ],
  },
];

export function createAppRouter(options?: { initialEntries?: string[] }) {
  if (options?.initialEntries) {
    return createMemoryRouter(routes, { initialEntries: options.initialEntries });
  }

  return createBrowserRouter(routes);
}

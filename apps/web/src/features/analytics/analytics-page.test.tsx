import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { App } from '../../App.js';
import { createAppRouter } from '../../app/router.js';
import { createAnalyticsOverviewFixture } from '../../testing/fixtures/records.js';
import { mockWebApiState } from '../../testing/msw/handlers.js';

function renderApp(initialEntries: string[]) {
  const router = createAppRouter({ initialEntries });
  return {
    router,
    ...render(<App router={router} />),
  };
}

describe('analytics page', () => {
  it('renders aggregate metrics, charts, and breakdown tables', async () => {
    renderApp(['/analytics']);

    expect(await screen.findAllByText('Estimated cost')).not.toHaveLength(0);
    expect(screen.getByText('Usage over time')).toBeInTheDocument();
    expect(screen.getByText('Usage by source')).toBeInTheDocument();
    expect(screen.getByText('Usage by model')).toBeInTheDocument();
    expect(screen.getByText('Top agents')).toBeInTheDocument();
  });

  it('renders the zero-data state when no events exist', async () => {
    mockWebApiState.setAnalyticsOverview(createAnalyticsOverviewFixture([]));
    renderApp(['/analytics']);

    expect(await screen.findByText('No analytics events yet')).toBeInTheDocument();
  });

  it('renders the reserved backend state for 501 analytics responses', async () => {
    mockWebApiState.setAnalyticsMode('not-implemented');
    renderApp(['/analytics']);

    expect(await screen.findByText('Analytics are reserved in the backend')).toBeInTheDocument();
  });

  it('switches windows and updates the URL state', async () => {
    const user = userEvent.setup();
    mockWebApiState.setAnalyticsOverview(
      createAnalyticsOverviewFixture(undefined, {
        topAgents: [
          {
            agentId: 'agt_fixture-seven-day',
            agentName: 'Seven Day Agent',
            estimatedCostUsd: 0.21,
            eventCount: 2,
          },
        ],
        window: '7d',
      }),
      '7d',
    );
    const { router } = renderApp(['/analytics']);

    await user.click(screen.getByRole('combobox', { name: 'Analytics window' }));
    await user.click(await screen.findByRole('option', { name: '7 days' }));

    expect(await screen.findByText('Seven Day Agent')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?window=7d');
  });

  it('drills from top agents into the agent detail route', async () => {
    const user = userEvent.setup();
    const { router } = renderApp(['/analytics']);

    await user.click(await screen.findByRole('link', { name: 'Ops Triage Agent' }));

    expect(await screen.findByText('Telegram channel status')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/agents/agt_fixture-agent');
  });
});

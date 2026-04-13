import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '../../App.js';
import { createAppRouter } from '../../app/router.js';
import { createAnalyticsOverviewFixture } from '../../testing/fixtures/records.js';
import { mockWebApiState } from '../../testing/msw/handlers.js';

function renderApp(initialEntries: string[]) {
  return render(<App router={createAppRouter({ initialEntries })} />);
}

describe('analytics page', () => {
  it('renders overview metrics and the chart shell', async () => {
    renderApp(['/analytics']);

    expect(await screen.findByText('Estimated cost')).toBeInTheDocument();
    expect(screen.getByText('Usage by source')).toBeInTheDocument();
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
});

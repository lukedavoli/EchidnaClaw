import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createAppRouter } from './app/router.js';
import { App } from './App.js';

function renderApp(initialEntries: string[]) {
  return render(<App router={createAppRouter({ initialEntries })} />);
}

describe('App routes', () => {
  it('redirects the root route to agents', async () => {
    renderApp(['/']);

    expect(await screen.findByRole('heading', { name: 'Agents' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create agent' })).toBeInTheDocument();
  });

  it('renders the not-found page inside the shell', async () => {
    renderApp(['/missing']);

    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Return to agents' })).toHaveAttribute(
      'href',
      '/agents',
    );
  });
});

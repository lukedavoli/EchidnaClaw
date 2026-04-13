import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { App } from '../../App.js';
import { createAppRouter } from '../../app/router.js';
import { createAgentFixture } from '../../testing/fixtures/records.js';
import { mockWebApiState } from '../../testing/msw/handlers.js';

function renderApp(initialEntries: string[]) {
  return render(<App router={createAppRouter({ initialEntries })} />);
}

function requireElement<T extends Element>(value: T | null) {
  expect(value).not.toBeNull();
  return value as unknown as HTMLElement;
}

describe('agents page flows', () => {
  it('creates an agent and returns to the list view', async () => {
    const user = userEvent.setup();
    renderApp(['/agents/new']);

    await user.type(screen.getByLabelText('Name'), 'Launch Agent');
    await user.clear(screen.getByLabelText('Time zone'));
    await user.type(screen.getByLabelText('Time zone'), 'UTC');
    await user.click(screen.getByRole('button', { name: 'Create agent' }));

    expect(await screen.findByRole('heading', { name: 'Agents' })).toBeInTheDocument();
    expect(await screen.findByText('Launch Agent')).toBeInTheDocument();
  });

  it('archives and restores an agent across active and archived views', async () => {
    const user = userEvent.setup();
    renderApp(['/agents']);

    const card = await screen.findByText('Ops Triage Agent');
    const activeCard = requireElement(card.closest('[class*="mantine-Card-root"]'));
    await user.click(within(activeCard).getByRole('button', { name: 'Archive' }));
    await user.click(await screen.findByRole('button', { name: 'Archive agent' }));

    await user.click(screen.getByRole('radio', { name: /Archived/i }));
    expect(await screen.findByText('Ops Triage Agent')).toBeInTheDocument();

    const archivedCard = requireElement(
      screen.getByText('Ops Triage Agent').closest('[class*="mantine-Card-root"]'),
    );
    await user.click(within(archivedCard).getByRole('button', { name: 'Restore' }));
    await user.click(await screen.findByRole('button', { name: 'Restore agent' }));

    await user.click(screen.getByRole('radio', { name: /Active/i }));
    expect(await screen.findByText('Ops Triage Agent')).toBeInTheDocument();
  });

  it('refreshes on demand instead of background polling', async () => {
    const user = userEvent.setup();
    renderApp(['/agents']);

    await screen.findByText('Ops Triage Agent');
    mockWebApiState.addAgent(
      createAgentFixture({
        id: 'agt_fixture-external',
        name: 'External Agent',
        updatedAt: '2026-04-13T12:00:00.000Z',
      }),
    );

    expect(screen.queryByText('External Agent')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('External Agent')).toBeInTheDocument();
  });
});

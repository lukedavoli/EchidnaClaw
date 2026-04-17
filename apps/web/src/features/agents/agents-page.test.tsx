import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { App } from '../../App.js';
import { createAppRouter } from '../../app/router.js';
import { createAdminAgentSummaryFixture } from '../../testing/fixtures/records.js';
import { mockWebApiState } from '../../testing/msw/handlers.js';

function renderApp(initialEntries: string[]) {
  const router = createAppRouter({ initialEntries });
  return {
    router,
    ...render(<App router={router} />),
  };
}

function requireElement<T extends Element>(value: T | null) {
  expect(value).not.toBeNull();
  return value as unknown as HTMLElement;
}

describe('agents page flows', () => {
  it('creates an agent and lands on the provisioning handoff', async () => {
    const user = userEvent.setup();
    const { router } = renderApp(['/agents/new']);

    await user.type(screen.getByLabelText('Name'), 'Launch Agent');
    await user.clear(screen.getByLabelText('Time zone'));
    await user.type(screen.getByLabelText('Time zone'), 'UTC');
    await user.click(screen.getByRole('button', { name: 'Create agent' }));

    expect(await screen.findByText('Launch Agent')).toBeInTheDocument();
    expect(await screen.findByText('Submit Telegram bot token')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/agents/agt_created-3');
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
  }, 10000);

  it('refreshes on demand instead of background polling', async () => {
    const user = userEvent.setup();
    renderApp(['/agents']);

    await screen.findByText('Ops Triage Agent');
    mockWebApiState.addAgent(
      createAdminAgentSummaryFixture({
        agent: {
          id: 'agt_fixture-external',
          name: 'External Agent',
          primaryChannelId: 'chn_fixture-external',
          updatedAt: '2026-04-13T12:00:00.000Z',
        },
        primaryChannel: {
          agentId: 'agt_fixture-external',
          id: 'chn_fixture-external',
          updatedAt: '2026-04-13T12:00:00.000Z',
        },
      }),
    );

    expect(screen.queryByText('External Agent')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('External Agent')).toBeInTheDocument();
  });

  it('opens the detail page from the roster card', async () => {
    const user = userEvent.setup();
    const { router } = renderApp(['/agents']);

    const card = requireElement(
      (await screen.findByText('Ops Triage Agent')).closest('[class*="mantine-Card-root"]'),
    );
    await user.click(within(card).getByRole('link', { name: 'Open' }));

    expect(await screen.findByText('Telegram channel status')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/agents/agt_fixture-agent');
  });

  it('retries provisioning when the primary channel is failed', async () => {
    const user = userEvent.setup();
    mockWebApiState.setAgents([
      createAdminAgentSummaryFixture({
        agent: {
          id: 'agt_fixture-failed',
          name: 'Failed Provisioning Agent',
          primaryChannelId: 'chn_fixture-failed',
          provisioningState: 'provisioning_failed',
        },
        primaryChannel: {
          agentId: 'agt_fixture-failed',
          id: 'chn_fixture-failed',
          lastProvisioningErrorMessage: 'The managed bot could not be bound.',
          lastProvisioningFailedAt: '2026-04-13T09:00:00.000Z',
          state: 'provisioning_failed',
        },
      }),
    ]);

    renderApp(['/agents']);

    const card = requireElement(
      (await screen.findByText('Failed Provisioning Agent')).closest('[class*="mantine-Card-root"]'),
    );
    await user.click(within(card).getByRole('button', { name: 'Retry provisioning' }));

    expect(await screen.findByText('Provisioning retry requested')).toBeInTheDocument();
  });
});

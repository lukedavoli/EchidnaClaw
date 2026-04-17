import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '../../App.js';
import { createAppRouter } from '../../app/router.js';
import {
  createAdminAgentSummaryFixture,
  createAnalyticsAgentSummaryFixture,
} from '../../testing/fixtures/records.js';
import { mockWebApiState } from '../../testing/msw/handlers.js';

function renderApp(initialEntries: string[]) {
  return render(<App router={createAppRouter({ initialEntries })} />);
}

describe('agent detail page', () => {
  it('renders channel metadata and recent usage for an active agent', async () => {
    mockWebApiState.setAgents([
      createAdminAgentSummaryFixture({
        agent: {
          id: 'agt_fixture-active',
          name: 'Active Agent',
          primaryChannelId: 'chn_fixture-active',
        },
        primaryChannel: {
          agentId: 'agt_fixture-active',
          credentialId: 'crd_fixture-active',
          externalHandle: 'active-agent-bot',
          id: 'chn_fixture-active',
        },
      }),
    ]);
    mockWebApiState.setAgentAnalytics(
      'agt_fixture-active',
      createAnalyticsAgentSummaryFixture({
        agentId: 'agt_fixture-active',
        agentName: 'Active Agent',
      }),
    );

    renderApp(['/agents/agt_fixture-active']);

    expect(await screen.findByText('Telegram channel status')).toBeInTheDocument();
    expect(screen.getByText('Credential bound')).toBeInTheDocument();
    expect(screen.getByText('Recent usage')).toBeInTheDocument();
    expect(screen.getByText('Open global analytics for wider investigation')).toBeInTheDocument();
  });

  it('keeps archived agents in read-only mode until restored', async () => {
    mockWebApiState.setAgents([
      createAdminAgentSummaryFixture({
        agent: {
          id: 'agt_fixture-archived',
          lifecycleState: 'soft_deleted',
          name: 'Archived Agent',
          primaryChannelId: 'chn_fixture-archived',
          softDeletedAt: '2026-04-13T12:00:00.000Z',
        },
        primaryChannel: {
          agentId: 'agt_fixture-archived',
          externalHandle: 'archived-agent-bot',
          id: 'chn_fixture-archived',
          state: 'active',
        },
      }),
    ]);

    renderApp(['/agents/agt_fixture-archived']);

    expect(await screen.findByText(/This agent is archived/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Jump to conversation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry provisioning' })).toBeDisabled();
  });

  it('shows a not-found state for missing agents', async () => {
    mockWebApiState.setAgents([]);

    renderApp(['/agents/agt_missing']);

    expect(await screen.findByText('Agent not found')).toBeInTheDocument();
  });
});

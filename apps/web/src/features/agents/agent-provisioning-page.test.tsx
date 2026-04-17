import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { App } from '../../App.js';
import { createAppRouter } from '../../app/router.js';
import {
  createAdminAgentSummaryFixture,
  createTelegramProvisioningHandoffFixture,
} from '../../testing/fixtures/records.js';
import { mockWebApiState } from '../../testing/msw/handlers.js';

function renderApp(initialEntries: string[]) {
  return render(<App router={createAppRouter({ initialEntries })} />);
}

describe('agent provisioning page', () => {
  it('submits a Telegram bot token and reveals the deep-link binding step', async () => {
    const user = userEvent.setup();
    mockWebApiState.setAgents([
      createAdminAgentSummaryFixture({
        agent: {
          id: 'agt_fixture-provisioning',
          name: 'Provisioning Agent',
          primaryChannelId: 'chn_fixture-provisioning',
          provisioningState: 'pending_provisioning',
        },
        primaryChannel: {
          agentId: 'agt_fixture-provisioning',
          id: 'chn_fixture-provisioning',
          state: 'pending_provisioning',
        },
      }),
    ]);
    mockWebApiState.setProvisioningHandoff(
      createTelegramProvisioningHandoffFixture({
        agentId: 'agt_fixture-provisioning',
        channelId: 'chn_fixture-provisioning',
      }),
    );

    renderApp(['/agents/agt_fixture-provisioning/provisioning']);

    expect(await screen.findByText('Provisioning Agent')).toBeInTheDocument();
    await user.type(await screen.findByLabelText('Bot token'), '123456:good-token');
    await user.click(await screen.findByRole('button', { name: 'Verify token' }));

    expect(await screen.findByRole('link', { name: 'Open Telegram' })).toBeInTheDocument();
    expect(await screen.findByText('bootstrap-code-123')).toBeInTheDocument();
  });

  it('retries a failed provisioning session and refreshes the handoff state', async () => {
    const user = userEvent.setup();
    mockWebApiState.setAgents([
      createAdminAgentSummaryFixture({
        agent: {
          id: 'agt_fixture-retry',
          name: 'Retry Agent',
          primaryChannelId: 'chn_fixture-retry',
          provisioningState: 'provisioning_failed',
        },
        primaryChannel: {
          agentId: 'agt_fixture-retry',
          botDisplayName: 'Retry Bot',
          credentialId: 'crd_fixture-retry',
          externalHandle: 'retry-bot',
          id: 'chn_fixture-retry',
          lastProvisioningErrorCode: 'telegram_bootstrap_expired',
          lastProvisioningErrorMessage: 'The Telegram bootstrap link expired.',
          lastProvisioningFailedAt: '2026-04-13T11:00:00.000Z',
          state: 'provisioning_failed',
        },
      }),
    ]);
    mockWebApiState.setProvisioningHandoff(
      createTelegramProvisioningHandoffFixture({
        agentId: 'agt_fixture-retry',
        botDisplayName: 'Retry Bot',
        botHandle: 'retry-bot',
        channelId: 'chn_fixture-retry',
        instructions: [
          'The Telegram bootstrap link expired.',
          'Retry the flow to rotate the bootstrap step.',
        ],
        lastErrorCode: 'telegram_bootstrap_expired',
        lastErrorMessage: 'The Telegram bootstrap link expired.',
        openTelegramUrl: null,
        operatorActionUrl: null,
        provider: 'telegram',
        requiresBotToken: false,
        state: 'failed',
      }),
    );

    renderApp(['/agents/agt_fixture-retry/provisioning']);

    expect(await screen.findByText('Retry Agent')).toBeInTheDocument();
    const retryButtons = await screen.findAllByRole('button', { name: 'Retry provisioning' });
    await user.click(retryButtons[retryButtons.length - 1]!);

    expect(await screen.findByRole('link', { name: 'Open Telegram' })).toBeInTheDocument();
    expect(await screen.findByText('retry-bootstrap-code')).toBeInTheDocument();
  });
});

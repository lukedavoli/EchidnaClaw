import { errorResponseSchema, readinessResponseSchema } from '@echidna-claw/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  createAnalyticsAgentSummaryFixture,
  createAnalyticsOverviewFixture,
} from '../../testing/fixtures/records.js';
import { createWebApiClient } from './client.js';

describe('web api client', () => {
  it('accepts readiness responses even when the API returns 503', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(
          readinessResponseSchema.parse({
            dependencies: {
              repositories: {
                description: 'Repositories are still wiring up.',
                mode: 'in_memory',
                ready: false,
              },
            },
            runtimeMode: 'local-minimal',
            service: 'api',
            status: 'not_ready',
          }),
        ),
        {
          headers: {
            'Content-Type': 'application/json',
          },
          status: 503,
        },
      ),
    );

    const client = createWebApiClient({
      baseUrl: 'http://example.test',
      fetchImplementation,
    });

    await expect(client.getReadiness()).resolves.toMatchObject({
      status: 'not_ready',
    });
  });

  it('normalizes structured API errors', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(
          errorResponseSchema.parse({
            error: {
              code: 'not_implemented_yet',
              message: 'Agent persistence is reserved for Step 5.',
              retryable: false,
              traceId: 'trc_mock-trace',
            },
          }),
        ),
        {
          headers: {
            'Content-Type': 'application/json',
          },
          status: 501,
        },
      ),
    );

    const client = createWebApiClient({
      baseUrl: 'http://example.test',
      fetchImplementation,
    });

    await expect(client.listAgents()).rejects.toEqual(
      expect.objectContaining({
        code: 'not_implemented_yet',
        kind: 'api',
        status: 501,
        traceId: 'trc_mock-trace',
      }),
    );
  });

  it('submits Telegram bot tokens to the provisioning endpoint', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          agentId: 'agt_provisioning',
          channelId: 'chn_provisioning',
          provider: 'telegram',
          attemptNumber: 1,
          state: 'awaiting_operator_binding',
          requiresBotToken: false,
          botHandle: 'echidna_claw_bot',
          botDisplayName: 'Echidna Claw Bot',
          openTelegramUrl: 'https://t.me/echidna_claw_bot?start=bootstrap-code',
          operatorActionUrl: 'https://t.me/BotFather',
          instructions: ['Open the bot chat.', 'Send the bootstrap code from your operator account.'],
          bootstrapCode: 'bootstrap-code',
          bootstrapExpiresAt: '2026-04-12T00:30:00.000Z',
          lastErrorCode: null,
          lastErrorMessage: null,
        }),
        {
          headers: {
            'Content-Type': 'application/json',
          },
          status: 200,
        },
      ),
    );

    const client = createWebApiClient({
      baseUrl: 'http://example.test',
      fetchImplementation,
    });

    await expect(
      client.submitTelegramBotToken('agt_provisioning', {
        botToken: '123456:telegram-secret-token',
      }),
    ).resolves.toMatchObject({
      agentId: 'agt_provisioning',
      state: 'awaiting_operator_binding',
      botHandle: 'echidna_claw_bot',
    });

    expect(fetchImplementation).toHaveBeenCalledWith(
      'http://example.test/api/admin/agents/agt_provisioning/telegram-provisioning/token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Accept: 'application/json',
          'Content-Type': 'application/json',
        }),
        body: expect.stringContaining('"botToken":"123456:telegram-secret-token"'),
      }),
    );
  });

  it('applies analytics window query parameters for overview and agent reads', async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(createAnalyticsOverviewFixture(undefined, { window: '7d' })), {
          headers: {
            'Content-Type': 'application/json',
          },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            createAnalyticsAgentSummaryFixture({
              agentId: 'agt_fixture-agent',
              overrides: {
                window: '24h',
              },
            }),
          ),
          {
            headers: {
              'Content-Type': 'application/json',
            },
            status: 200,
          },
        ),
      );

    const client = createWebApiClient({
      baseUrl: 'http://example.test',
      fetchImplementation,
    });

    await expect(client.getAnalyticsOverview('7d')).resolves.toMatchObject({
      window: '7d',
    });
    await expect(client.getAgentAnalytics('agt_fixture-agent', '24h')).resolves.toMatchObject({
      agentId: 'agt_fixture-agent',
      window: '24h',
    });

    expect(fetchImplementation).toHaveBeenNthCalledWith(
      1,
      'http://example.test/api/admin/analytics/overview?window=7d',
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      2,
      'http://example.test/api/admin/analytics/agents/agt_fixture-agent?window=24h',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });
});

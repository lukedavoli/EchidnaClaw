import { errorResponseSchema, readinessResponseSchema } from '@echidna-claw/contracts';
import { describe, expect, it, vi } from 'vitest';

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
});

import { describe, expect, it, vi } from 'vitest';

import {
  createLoggerFactory,
  runWithRequestContext,
  updateRequestContext,
} from '../src/index.js';

describe('@echidna-claw/observability', () => {
  it('propagates request context through logger emission', () => {
    const sink = vi.fn();
    const logger = createLoggerFactory({
      level: 'info',
      serviceName: 'api',
      sink,
    }).createLogger({ component: 'test' });

    runWithRequestContext(
      {
        actorKind: 'system',
        requestId: 'req-1',
        routeGroup: 'internal-runtime',
        startedAt: '2026-04-13T00:00:00.000Z',
        traceId: 'trc_trace-1',
      },
      () => {
        updateRequestContext({ agentId: 'agt_test-agent' });
        logger.info('hello', {
          nested: {
            authorization: 'secret-token',
            ok: true,
          },
          token: 'top-secret',
        });
      },
    );

    expect(sink).toHaveBeenCalledTimes(1);

    const [entry] = sink.mock.calls[0] as [Parameters<typeof sink>[0]];

    expect(entry.requestContext?.agentId).toBe('agt_test-agent');
    expect(entry.fields.token).toBe('[REDACTED]');
    expect((entry.fields.nested as { authorization: string }).authorization).toBe('[REDACTED]');
  });
});

import { describe, expect, it, vi } from 'vitest';

import {
  createLoggerFactory,
  redactAuditAttributes,
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

  it('redacts nested audit attributes before stringifying them', () => {
    const redacted = redactAuditAttributes({
      apiToken: 'top-secret',
      nested: {
        authorization: 'Bearer top-secret',
        safe: 'kept',
      },
      items: [
        {
          password: 'hidden',
        },
        'value',
      ],
    });

    expect(redacted.apiToken).toBe('[REDACTED]');
    expect(redacted.nested).toBe('{"authorization":"[REDACTED]","safe":"kept"}');
    expect(redacted.items).toBe('[{"password":"[REDACTED]"},"value"]');
  });
});

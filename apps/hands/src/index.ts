import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import process from 'node:process';

import fastify from 'fastify';
import { handsReleaseForUserRequestSchema, handsStartRunRequestSchema } from '@echidna-claw/contracts';
import { createLoggerFactory } from '@echidna-claw/observability';

import { assertInternalRuntimeAuthorized } from './auth.js';
import {
  createHandsCoordinator,
  createHandsRuntime,
  createHttpDispatchResult,
  parseHandsStartRunPayload,
  resolveHandsStartRunPayload,
} from './runtime.js';

const runtime = createHandsRuntime();
const logger = createLoggerFactory({
  level: 'info',
  serviceName: runtime.serviceName,
}).createLogger({ component: 'hands_app' });
const coordinator = createHandsCoordinator(undefined, logger.child({ component: 'coordinator' }));
const startedAt = new Date().toISOString();

let heartbeatCount = 0;

function writeLivenessSignal(): void {
  mkdirSync(dirname(runtime.livenessFile), { recursive: true });
  writeFileSync(
    runtime.livenessFile,
    JSON.stringify(
      {
        heartbeatCount,
        lastHeartbeatAt: new Date().toISOString(),
        pid: process.pid,
        runtimeMode: runtime.runtimeMode,
        service: runtime.serviceName,
        startedAt,
      },
      null,
      2,
    ),
  );
}

async function runOneShot(startRunPayload: string): Promise<void> {
  const request = parseHandsStartRunPayload(startRunPayload);
  const result = await coordinator.executeDispatchedRun(request);
  logger.info('hands_runtime.one_shot_finished', {
    startupOutcome: result.startupOutcome,
    taskId: result.taskId,
    taskState: result.taskState,
  });

  if (result.startupOutcome === 'claim_failed' || result.taskState === 'failed') {
    process.exitCode = 1;
  }
}

async function startServer(): Promise<void> {
  const app = fastify({
    logger: false,
  });

  app.setErrorHandler(async (error, request, reply) => {
    const message = error instanceof Error ? error.message : 'Hands runtime request failed.';
    logger.error('hands_runtime.request_failed', {
      message,
      method: request.method,
      url: request.url,
    });
    reply.code(500).send({
      error: {
        code: 'hands_runtime_failed',
        message,
      },
    });
  });

  app.addHook('onRequest', async (request) => {
    assertInternalRuntimeAuthorized(request, runtime.internalAuthToken);
  });

  app.post('/internal/hands/start-run', async (request) => {
    const payload = handsStartRunRequestSchema.parse(request.body);
    void coordinator.executeDispatchedRun(payload).catch((error) => {
      logger.error('hands_runtime.background_dispatch_failed', {
        message: error instanceof Error ? error.message : 'Unknown Hands background dispatch failure.',
        taskId: payload.taskId,
      });
    });

    return createHttpDispatchResult(payload, 'http');
  });

  app.post('/internal/hands/release-for-user', async (request, reply) => {
    const payload = handsReleaseForUserRequestSchema.parse(request.body);
    logger.warn('hands_runtime.release_for_user_not_implemented', {
      handsRunId: payload.handsRunId,
    });
    reply.code(501);
    return {
      error: {
        code: 'not_implemented',
        message: 'Hands release-for-user remains reserved for Step 16.',
      },
    };
  });

  app.get('/healthz', async () => ({
    ok: true,
    service: runtime.serviceName,
  }));

  await app.listen({
    host: runtime.host,
    port: runtime.port,
  });

  console.log(runtime.startupMessage);
  console.log(`[${runtime.serviceName}] heartbeat interval ${runtime.heartbeatIntervalMs}ms`);
  console.log(`[${runtime.serviceName}] liveness file ${runtime.livenessFile}`);
  console.log(`[${runtime.serviceName}] listening on http://${runtime.host}:${runtime.port}`);

  writeLivenessSignal();
  const heartbeatTimer = setInterval(() => {
    heartbeatCount += 1;
    writeLivenessSignal();
    logger.info('hands_runtime.heartbeat', { heartbeatCount });
  }, runtime.heartbeatIntervalMs);

  const shutdown = async (signal: 'SIGINT' | 'SIGTERM') => {
    clearInterval(heartbeatTimer);
    logger.info('hands_runtime.stopping', { signal });
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

const startRunPayload = runtime.startRunPayload ?? resolveHandsStartRunPayload(process.argv.slice(2));

if (startRunPayload) {
  void runOneShot(startRunPayload);
} else {
  void startServer();
}

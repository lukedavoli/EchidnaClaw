import { mkdirSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { dirname } from 'node:path';

import { loadHandsConfig } from '@echidna-claw/config';

import { createHandsRuntime } from './runtime.js';

const config = loadHandsConfig();
const runtime = createHandsRuntime(config);
const startedAt = new Date().toISOString();

console.log(runtime.startupMessage);
console.log(`[${runtime.serviceName}] heartbeat interval ${runtime.heartbeatIntervalMs}ms`);
console.log(`[${runtime.serviceName}] liveness file ${runtime.livenessFile}`);

let heartbeatCount = 0;

function writeLivenessSignal(): void {
  try {
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
  } catch (error) {
    console.error(`[${runtime.serviceName}] failed to write liveness signal`, error);
  }
}

writeLivenessSignal();

const heartbeatTimer = setInterval(() => {
  heartbeatCount += 1;
  writeLivenessSignal();
  console.log(`[${runtime.serviceName}] heartbeat ${heartbeatCount}`);
}, runtime.heartbeatIntervalMs);

function shutdown(signal: 'SIGINT' | 'SIGTERM'): void {
  clearInterval(heartbeatTimer);
  console.log(`[${runtime.serviceName}] stopping after ${signal}`);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

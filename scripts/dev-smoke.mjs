import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

for (const fileName of ['.env', '.env.local']) {
  const filePath = resolve(repoRoot, fileName);

  if (existsSync(filePath)) {
    loadDotenv({ override: true, path: filePath });
  }
}

const apiHost = process.env.ECHIDNA_API_HOST ?? '127.0.0.1';
const apiPort = process.env.ECHIDNA_API_PORT ?? '3001';
const sandboxHost = process.env.ECHIDNA_SANDBOX_HOST ?? '127.0.0.1';
const sandboxPort = process.env.ECHIDNA_SANDBOX_PORT ?? '3002';
const webUrl = process.env.VITE_APP_BASE_URL ?? 'http://127.0.0.1:5173';
const heartbeatIntervalMs = Number.parseInt(
  process.env.ECHIDNA_HANDS_HEARTBEAT_INTERVAL_MS ?? '30000',
  10,
);
const handsLivenessFile =
  process.env.ECHIDNA_HANDS_LIVENESS_FILE?.trim() ||
  resolve(tmpdir(), 'echidna-claw', 'hands-liveness.json');

async function fetchOk(url, label, expectJson = false) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });

  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}`);
  }

  if (!expectJson) {
    return;
  }

  const payload = await response.json();

  if (payload?.status !== 'ok') {
    throw new Error(`${label} returned an unexpected payload`);
  }
}

function assertHandsHeartbeat() {
  if (!existsSync(handsLivenessFile)) {
    throw new Error(`hands liveness file not found at ${handsLivenessFile}`);
  }

  const payload = JSON.parse(readFileSync(handsLivenessFile, 'utf8'));
  const lastHeartbeatAt = new Date(payload.lastHeartbeatAt ?? payload.startedAt);

  if (Number.isNaN(lastHeartbeatAt.getTime())) {
    throw new Error('hands liveness payload did not include a readable timestamp');
  }

  const maxAgeMs = Math.max(heartbeatIntervalMs * 2, 5000) + 5000;

  if (Date.now() - lastHeartbeatAt.getTime() > maxAgeMs) {
    throw new Error(`hands liveness signal is stale in ${handsLivenessFile}`);
  }
}

try {
  await fetchOk(webUrl, 'web');
  await fetchOk(`http://${apiHost}:${apiPort}/healthz`, 'api', true);
  await fetchOk(`http://${sandboxHost}:${sandboxPort}/healthz`, 'sandbox', true);
  assertHandsHeartbeat();

  console.log('Smoke checks passed for web, api, sandbox, and hands.');
} catch (error) {
  console.error('Smoke checks failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

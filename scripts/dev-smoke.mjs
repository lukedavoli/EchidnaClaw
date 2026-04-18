import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = new Set(process.argv.slice(2));

for (const fileName of ['.env', '.env.local']) {
  const filePath = resolve(repoRoot, fileName);

  if (existsSync(filePath)) {
    loadDotenv({ override: true, path: filePath });
  }
}

const smokeTarget = args.has('--deployed')
  ? 'deployed'
  : args.has('--local')
    ? 'local'
    : (process.env.ECHIDNA_SMOKE_TARGET ?? 'local');
const apiHost = process.env.ECHIDNA_API_HOST ?? '127.0.0.1';
const apiPort = process.env.ECHIDNA_API_PORT ?? '3001';
const sandboxHost = process.env.ECHIDNA_SANDBOX_HOST ?? '127.0.0.1';
const sandboxPort = process.env.ECHIDNA_SANDBOX_PORT ?? '3002';
const internalRuntimeAuthToken =
  process.env.ECHIDNA_INTERNAL_RUNTIME_AUTH_TOKEN ?? 'local-internal-runtime-token';
const webUrl = process.env.VITE_APP_BASE_URL ?? 'http://127.0.0.1:5173';
const deployedWebUrl = process.env.ECHIDNA_WEB_PUBLIC_BASE_URL?.trim();
const deployedApiBaseUrl = process.env.ECHIDNA_API_PUBLIC_BASE_URL?.trim();
const deployedSandboxBaseUrl = process.env.ECHIDNA_SANDBOX_BASE_URL?.trim();
const heartbeatIntervalMs = Number.parseInt(
  process.env.ECHIDNA_HANDS_HEARTBEAT_INTERVAL_MS ?? '30000',
  10,
);
const skipSandboxExec =
  args.has('--skip-sandbox-exec') || process.env.ECHIDNA_SMOKE_SKIP_SANDBOX_EXEC === 'true';
const configuredHandsLivenessFile = process.env.ECHIDNA_HANDS_LIVENESS_FILE?.trim();
const handsLivenessCandidates = configuredHandsLivenessFile
  ? [
      isAbsolute(configuredHandsLivenessFile)
        ? configuredHandsLivenessFile
        : resolve(repoRoot, configuredHandsLivenessFile),
    ]
  : [
      resolve(tmpdir(), 'echidna-claw', 'hands-liveness.json'),
      resolve(repoRoot, '.compose', 'hands', 'hands-liveness.json'),
    ];

function ensureAbsoluteBaseUrl(value, label) {
  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`${label} must be set to an absolute URL`);
  }
}

function joinUrl(baseUrl, path) {
  return new URL(path, `${baseUrl.replace(/\/$/, '')}/`).toString();
}

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

async function fetchJson(url, init, label) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}`);
  }

  return response.json();
}

async function runSandboxSmoke(options) {
  const headers = {
    'content-type': 'application/json',
    'x-echidna-internal-token': internalRuntimeAuthToken,
  };
  const created = await fetchJson(
    joinUrl(options.sandboxBaseUrl, '/internal/sessions'),
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agentId: 'agt_smoke',
        taskId: 'tsk_smoke',
        handsRunId: 'hnd_smoke',
        sessionId: 'sbx_smoke',
        policyName: 'standard',
        packageAllowlistName: 'default-runtime-pnpm',
        credentialAliases: [],
        correlation: {
          traceId: 'trc_smoke',
          idempotencyKey: 'idem_smoke',
        },
      }),
    },
    'sandbox create-session smoke',
  );
  const command = await fetchJson(
    joinUrl(options.sandboxBaseUrl, `/internal/sessions/${created.id}/commands`),
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        command: 'echo smoke',
        correlation: {
          traceId: 'trc_smoke-command',
          idempotencyKey: 'idem_smoke-command',
        },
      }),
    },
    'sandbox execute-command smoke',
  );

  if (command.status !== 'completed') {
    throw new Error(`sandbox execute-command smoke failed with status ${command.status}`);
  }

  await fetchJson(
    joinUrl(options.sandboxBaseUrl, `/internal/sessions/${created.id}/close`),
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        reason: 'completed',
        correlation: {
          traceId: 'trc_smoke-close',
          idempotencyKey: 'idem_smoke-close',
        },
      }),
    },
    'sandbox close-session smoke',
  );
}

function assertHandsHeartbeat() {
  const handsLivenessFile = handsLivenessCandidates.find((candidate) => existsSync(candidate));

  if (!handsLivenessFile) {
    throw new Error(
      `hands liveness file not found at any expected path: ${handsLivenessCandidates.join(', ')}`,
    );
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

async function runLocalSmoke() {
  const apiBaseUrl = `http://${apiHost}:${apiPort}`;
  const sandboxBaseUrl = `http://${sandboxHost}:${sandboxPort}`;

  await fetchOk(webUrl, 'web');
  await fetchOk(joinUrl(apiBaseUrl, '/healthz'), 'api', true);
  await fetchOk(joinUrl(sandboxBaseUrl, '/healthz'), 'sandbox', true);
  if (!skipSandboxExec) {
    await runSandboxSmoke({ sandboxBaseUrl });
  }
  assertHandsHeartbeat();

  return skipSandboxExec
    ? 'Smoke checks passed for web, api, sandbox health, and hands.'
    : 'Smoke checks passed for web, api, sandbox, sandbox execution, and hands.';
}

async function runDeployedSmoke() {
  if (!deployedWebUrl) {
    throw new Error('ECHIDNA_WEB_PUBLIC_BASE_URL is required for deployed smoke checks');
  }
  if (!deployedApiBaseUrl) {
    throw new Error('ECHIDNA_API_PUBLIC_BASE_URL is required for deployed smoke checks');
  }

  const webBaseUrl = ensureAbsoluteBaseUrl(deployedWebUrl, 'ECHIDNA_WEB_PUBLIC_BASE_URL');
  const apiBaseUrl = ensureAbsoluteBaseUrl(deployedApiBaseUrl, 'ECHIDNA_API_PUBLIC_BASE_URL');
  const sandboxBaseUrl = deployedSandboxBaseUrl
    ? ensureAbsoluteBaseUrl(deployedSandboxBaseUrl, 'ECHIDNA_SANDBOX_BASE_URL')
    : null;

  await fetchOk(webBaseUrl, 'web');
  await fetchOk(joinUrl(apiBaseUrl, '/healthz'), 'api', true);

  const completedChecks = ['web', 'api'];
  if (sandboxBaseUrl) {
    await fetchOk(joinUrl(sandboxBaseUrl, '/healthz'), 'sandbox', true);
    completedChecks.push('sandbox');

    if (!skipSandboxExec) {
      await runSandboxSmoke({ sandboxBaseUrl });
      completedChecks.push('sandbox execution');
    }
  }

  return `Smoke checks passed for ${completedChecks.join(', ')}.`;
}

try {
  if (!['deployed', 'local'].includes(smokeTarget)) {
    throw new Error(`Unsupported smoke target '${smokeTarget}'. Use 'local' or 'deployed'.`);
  }

  const summary = smokeTarget === 'deployed' ? await runDeployedSmoke() : await runLocalSmoke();
  console.log(summary);
} catch (error) {
  console.error('Smoke checks failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

import {
  handsDispatchResultSchema,
  handsEnqueueFollowUpResultSchema,
  handsRunSchema,
  handsStartRunRequestSchema,
  sandboxExecuteCommandResultSchema,
  sandboxSessionSchema,
  type HandsDispatchResult,
  type HandsRun,
  type HandsStartRunRequest,
  type SandboxCloseSessionRequest,
  type SandboxCreateSessionRequest,
  type SandboxExecuteCommandRequest,
  type SandboxExecuteCommandResult,
  type SandboxSession,
} from '@echidna-claw/contracts';
import { loadHandsConfig, type HandsConfig } from '@echidna-claw/config';
import { createHandsExecutionCoordinator } from '@echidna-claw/hands-runtime';
import { createLoggerFactory, type Logger } from '@echidna-claw/observability';
import {
  createAzureRepositorySuite,
  createInMemoryRepositorySuite,
  type RepositorySuite,
} from '@echidna-claw/persistence';

import { INTERNAL_RUNTIME_AUTH_HEADER } from './auth.js';

export type HandsRuntime = {
  apiBaseUrl: string;
  heartbeatIntervalMs: number;
  host: string;
  internalAuthToken: string;
  internalSandboxBaseUrl: string;
  livenessFile: string;
  port: number;
  runtimeMode: HandsConfig['runtimeMode'];
  serviceName: 'hands';
  startRunPayload: string | null;
  startupMessage: string;
  workerInstanceId: string;
};

function createRuntimeLogger(config: HandsConfig) {
  return createLoggerFactory({
    level: config.logLevel,
    serviceName: config.serviceName,
  }).createLogger({ service: 'hands_runtime' });
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: {
        message?: string;
      };
    };
    return payload.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

async function assertOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) {
    return;
  }

  throw new Error(await readErrorMessage(response, fallback));
}

function createApiUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl.replace(/\/$/, '')}/`).toString();
}

function createRepositorySuiteForHands(config: HandsConfig): RepositorySuite {
  return config.runtimeMode === 'local-minimal'
    ? createInMemoryRepositorySuite()
    : (() => {
        if (!config.sharedCloud) {
          throw new Error('Shared-cloud repository configuration is required outside local-minimal mode.');
        }

        return createAzureRepositorySuite({
          artifactsContainerName: config.sharedCloud.blobStorage.artifactsContainer,
          blobAccountUrl: config.sharedCloud.blobStorage.accountUrl,
          cosmosDatabaseName: config.sharedCloud.cosmosDb.databaseName,
          cosmosEndpoint: config.sharedCloud.cosmosDb.endpoint,
          keyEncryptionKeyId: config.sharedCloud.keyVault.keyId,
        });
      })();
}

function createHandsFollowUpQueueClient(config: HandsConfig) {
  return {
    async enqueueFollowUpTasks(input: {
      agentId: string;
      correlation: HandsStartRunRequest['correlation'];
      followUpTasks: import('@echidna-claw/contracts').HandsFollowUpTaskRequest[];
      handsRunId: string;
      taskId: string;
      workingContextId: string;
    }) {
      const response = await fetch(createApiUrl(config.apiBaseUrl, '/api/internal/runtime/hands/follow-up-tasks'), {
        body: JSON.stringify(input),
        headers: {
          'content-type': 'application/json',
          [INTERNAL_RUNTIME_AUTH_HEADER]: config.internalAuthToken,
        },
        method: 'POST',
        signal: AbortSignal.timeout(10000),
      });
      await assertOk(response, 'Hands follow-up task enqueue failed.');
      return handsEnqueueFollowUpResultSchema.parse(await response.json());
    },
  };
}

function createHandsSandboxClient(config: HandsConfig) {
  async function callSandbox(path: string, init: RequestInit): Promise<Response> {
    return fetch(createApiUrl(config.internalSandboxBaseUrl, path), {
      ...init,
      headers: {
        'content-type': 'application/json',
        [INTERNAL_RUNTIME_AUTH_HEADER]: config.internalAuthToken,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(10000),
    });
  }

  return {
    async closeSession(input: SandboxCloseSessionRequest): Promise<SandboxSession> {
      const response = await callSandbox(`/internal/sessions/${input.sessionId}/close`, {
        body: JSON.stringify(input),
        method: 'POST',
      });
      await assertOk(response, 'Hands could not close the sandbox session.');
      return sandboxSessionSchema.parse(await response.json());
    },
    async createSession(input: SandboxCreateSessionRequest): Promise<SandboxSession> {
      const payload = {
        ...input,
        sessionId: `sbx_${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`,
      };
      const response = await callSandbox('/internal/sessions', {
        body: JSON.stringify(payload),
        method: 'POST',
      });
      await assertOk(response, 'Hands could not create the sandbox session.');
      return sandboxSessionSchema.parse(await response.json());
    },
    async executeCommand(
      input: SandboxExecuteCommandRequest,
    ): Promise<SandboxExecuteCommandResult> {
      const response = await callSandbox(`/internal/sessions/${input.sessionId}/commands`, {
        body: JSON.stringify(input),
        method: 'POST',
      });
      await assertOk(response, 'Hands sandbox command execution failed.');
      return sandboxExecuteCommandResultSchema.parse(await response.json());
    },
    async getSession(sessionId: string): Promise<SandboxSession> {
      const response = await callSandbox(`/internal/sessions/${sessionId}`, {
        method: 'GET',
      });
      await assertOk(response, 'Hands could not load the sandbox session.');
      return sandboxSessionSchema.parse(await response.json());
    },
  };
}

export function createHandsRuntime(config: HandsConfig = loadHandsConfig()): HandsRuntime {
  return {
    apiBaseUrl: config.apiBaseUrl,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    host: config.host,
    internalAuthToken: config.internalAuthToken,
    internalSandboxBaseUrl: config.internalSandboxBaseUrl,
    livenessFile: config.livenessFile,
    port: config.port,
    runtimeMode: config.runtimeMode,
    serviceName: config.serviceName,
    startRunPayload: config.startRunPayload,
    startupMessage: `[${config.serviceName}] ready in ${config.nodeEnv} (${config.runtimeMode}) mode`,
    workerInstanceId: config.workerInstanceId,
  };
}

export function createHandsCoordinator(config: HandsConfig = loadHandsConfig(), logger?: Logger) {
  const suite = createRepositorySuiteForHands(config);

  return createHandsExecutionCoordinator({
    followUpQueue: createHandsFollowUpQueueClient(config),
    logger: logger ?? createRuntimeLogger(config),
    repositories: {
      agents: suite.agents,
      execution: suite.execution,
      tasks: suite.tasks,
      workingContexts: suite.workingContexts,
    },
    sandbox: createHandsSandboxClient(config),
    workerInstanceId: config.workerInstanceId,
  });
}

export function createHttpDispatchResult(
  input: HandsStartRunRequest,
  dispatchMode: HandsDispatchResult['dispatchMode'],
): HandsDispatchResult {
  return handsDispatchResultSchema.parse({
    acceptedAt: new Date().toISOString(),
    dispatchIdempotencyKey: input.dispatchIdempotencyKey,
    dispatchMode,
    dispatchReference: input.dispatchIdempotencyKey,
    taskEnvelopeId: input.taskEnvelopeId,
    taskId: input.taskId,
  });
}

export function parseHandsStartRunPayload(payload: string): HandsStartRunRequest {
  return handsStartRunRequestSchema.parse(JSON.parse(payload));
}

export function resolveHandsStartRunPayload(argv: readonly string[]): string | null {
  const inlineArg = argv.find((argument) => argument.startsWith('--start-run-payload='));
  if (inlineArg) {
    return inlineArg.slice('--start-run-payload='.length);
  }

  const flagIndex = argv.findIndex((argument) => argument === '--start-run-payload');
  return flagIndex >= 0 ? argv[flagIndex + 1] ?? null : null;
}

export function parseHandsDispatchResponse(payload: unknown): HandsDispatchResult {
  return handsDispatchResultSchema.parse(payload);
}

export function parseHandsRunResponse(payload: unknown): HandsRun {
  return handsRunSchema.parse(payload);
}

import {
  enqueueTaskResultSchema,
  handsDispatchResultSchema,
  handsEnqueueFollowUpRequestSchema,
  handsReleaseForUserRequestSchema,
  handsStartRunRequestSchema,
  type EnqueueTaskRequest,
  type HandsDispatchResult,
  type HandsEnqueueFollowUpRequest,
  type HandsFollowUpTaskRequest,
  type HandsReleaseForUserRequest,
  type HandsRun,
  type HandsStartRunRequest,
  type SchedulerProcessDueWorkRequest,
  type SchedulerProcessDueWorkResult,
} from '@echidna-claw/contracts';
import { DefaultAzureCredential } from '@azure/identity';
import { createHandsExecutionCoordinator } from '@echidna-claw/hands-runtime';
import { transitionHandsRunState, transitionTaskState } from '@echidna-claw/domain';
import type { Logger } from '@echidna-claw/observability';

import type { ApiRuntimeConfig } from '../../config/api-runtime-config.js';
import {
  ConflictError,
  DependencyUnavailableError,
  NotImplementedYetError,
  NotFoundError,
  ValidationError,
} from '../../http/errors.js';
import { INTERNAL_RUNTIME_AUTH_HEADER } from '../../http/protection.js';
import type { RepositoryBundle } from '../repositories/index.js';
import type { SandboxRuntimeAdapter } from '../sandbox/index.js';

export type TaskQueueGateway = {
  enqueueTask(input: EnqueueTaskRequest): Promise<ReturnType<typeof enqueueTaskResultSchema.parse>>;
};

type CloudHandsJobLauncher = {
  startJobExecution(input: {
    jobTarget: string;
    payload: string;
    workerInstanceId: string;
  }): Promise<{
    dispatchReference: string;
  }>;
};

export interface HandsJobTriggerAdapter {
  releaseForUser(input: HandsReleaseForUserRequest): Promise<HandsRun>;
  startRun(input: HandsStartRunRequest): Promise<HandsDispatchResult>;
}

export interface SchedulerRuntimeAdapter {
  processDueWork(input: SchedulerProcessDueWorkRequest): Promise<SchedulerProcessDueWorkResult>;
}

type CloudJobTemplateEnvVar = {
  name: string;
  secretRef?: string;
  value?: string;
};

type CloudJobTemplateContainer = {
  args?: string[];
  command?: string[];
  env?: CloudJobTemplateEnvVar[];
  image?: string;
  name: string;
  resources?: Record<string, unknown>;
  [key: string]: unknown;
};

type CloudJobTemplate = {
  containers: CloudJobTemplateContainer[];
};

function createDispatchResult(
  input: HandsStartRunRequest,
  acceptedAt: string,
  dispatchMode: HandsDispatchResult['dispatchMode'],
  dispatchReference: string,
): HandsDispatchResult {
  return handsDispatchResultSchema.parse({
    acceptedAt,
    dispatchIdempotencyKey: input.dispatchIdempotencyKey,
    dispatchMode,
    dispatchReference,
    taskEnvelopeId: input.taskEnvelopeId,
    taskId: input.taskId,
  });
}

async function releaseHandsRunForUser(input: {
  repositories: RepositoryBundle;
  request: HandsReleaseForUserRequest;
}): Promise<HandsRun> {
  const request = handsReleaseForUserRequestSchema.parse(input.request);
  const storedHandsRun = await input.repositories.execution.findHandsRun(request.handsRunId);
  if (!storedHandsRun) {
    throw new NotFoundError(`Hands run '${request.handsRunId}' was not found.`);
  }

  if (storedHandsRun.value.state === 'waiting_for_user') {
    return storedHandsRun.value;
  }

  if (storedHandsRun.value.state !== 'running') {
    return storedHandsRun.value;
  }

  const storedTask = await input.repositories.tasks.getTask(
    storedHandsRun.value.agentId,
    storedHandsRun.value.taskId,
  );
  if (!storedTask) {
    throw new NotFoundError(`Task '${storedHandsRun.value.taskId}' was not found.`);
  }

  const releasedTask =
    storedTask.value.state === 'waiting_for_user'
      ? {
          ...storedTask.value,
          currentHandsRunId: null,
          updatedAt: request.releasedAt,
        }
      : transitionTaskState(storedTask.value, 'waiting_for_user', request.releasedAt);
  const releasedHandsRun = transitionHandsRunState(
    storedHandsRun.value,
    'waiting_for_user',
    request.releasedAt,
  );

  return (
    await input.repositories.execution.releaseHandsRun({
      handsRun: releasedHandsRun,
      handsRunEtag: storedHandsRun.etag,
      task: releasedTask,
      taskEtag: storedTask.etag,
    })
  ).handsRun.value;
}

function createHandsUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl.replace(/\/$/, '')}/`).toString();
}

function createAzureResourceManagerUrl(resourceId: string, path: string): string {
  const normalizedResourceId = resourceId.replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `https://management.azure.com${normalizedResourceId}${normalizedPath}`;
}

function parseJobTargetResourceId(jobTarget: string): {
  jobName: string;
  resourceId: string;
} {
  const normalized = jobTarget.trim();
  const match = normalized.match(
    /^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/Microsoft\.App\/jobs\/([^/]+)$/i,
  );
  if (!match) {
    throw new DependencyUnavailableError(
      'ECHIDNA_HANDS_JOB_TARGET must be a Microsoft.App/jobs resource ID in cloud-deployed mode.',
    );
  }

  return {
    jobName: match[1]!,
    resourceId: normalized,
  };
}

async function readRuntimeError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: {
        message?: string;
      };
      detail?: string;
      message?: string;
      title?: string;
    };
    return (
      payload.error?.message ??
      payload.message ??
      payload.detail ??
      payload.title ??
      `Hands runtime returned HTTP ${response.status}.`
    );
  } catch {
    return `Hands runtime returned HTTP ${response.status}.`;
  }
}

async function assertRuntimeResponseOk(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }

  const message = await readRuntimeError(response);
  switch (response.status) {
    case 400:
      throw new ValidationError(message);
    case 404:
      throw new NotFoundError(message);
    case 409:
      throw new ConflictError(message);
    default:
      throw new DependencyUnavailableError(message);
  }
}

function createHttpHandsJobTriggerAdapter(options: {
  config: ApiRuntimeConfig;
  repositories: RepositoryBundle;
}): HandsJobTriggerAdapter {
  async function callHands(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(createHandsUrl(options.config.hands.baseUrl, path), {
        ...init,
        headers: {
          'content-type': 'application/json',
          [INTERNAL_RUNTIME_AUTH_HEADER]: options.config.internalRuntime.authToken,
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      throw new DependencyUnavailableError('Hands runtime is unavailable.', {
        cause: error,
      });
    }
  }

  return {
    async releaseForUser(input: HandsReleaseForUserRequest): Promise<HandsRun> {
      return releaseHandsRunForUser({
        repositories: options.repositories,
        request: input,
      });
    },
    async startRun(input: HandsStartRunRequest): Promise<HandsDispatchResult> {
      const request = handsStartRunRequestSchema.parse(input);
      const response = await callHands('/internal/hands/start-run', {
        body: JSON.stringify(request),
        method: 'POST',
      });
      await assertRuntimeResponseOk(response);
      return handsDispatchResultSchema.parse(await response.json());
    },
  };
}

function mergeTemplateEnvVars(
  existing: readonly CloudJobTemplateEnvVar[] | undefined,
  overrides: readonly CloudJobTemplateEnvVar[],
): CloudJobTemplateEnvVar[] {
  const merged = [...(existing ?? [])];

  for (const override of overrides) {
    const existingIndex = merged.findIndex((envVar) => envVar.name === override.name);
    if (existingIndex >= 0) {
      merged[existingIndex] = {
        ...merged[existingIndex],
        ...override,
      };
      continue;
    }

    merged.push(override);
  }

  return merged;
}

function resolveJobTemplateContainer(
  jobName: string,
  template: CloudJobTemplate,
): CloudJobTemplateContainer {
  if (template.containers.length === 0) {
    throw new DependencyUnavailableError('Hands job template does not define any containers.');
  }

  const namedContainer = template.containers.find((container) => container.name === jobName);
  if (namedContainer) {
    return namedContainer;
  }

  if (template.containers.length === 1) {
    return template.containers[0]!;
  }

  throw new DependencyUnavailableError(
    'Hands job template must contain a single container or a container named after the job.',
  );
}

function toExecutionTemplateContainer(
  container: CloudJobTemplateContainer,
): CloudJobTemplateContainer {
  return {
    ...(container.image ? { image: container.image } : {}),
    name: container.name,
    ...(container.command ? { command: container.command } : {}),
    ...(container.args ? { args: container.args } : {}),
    ...(container.env ? { env: container.env } : {}),
    ...(container.resources ? { resources: container.resources } : {}),
  };
}

function createJobExecutionTemplate(input: {
  jobName: string;
  payload: string;
  template: CloudJobTemplate;
  workerInstanceId: string;
}): {
  containers: CloudJobTemplateContainer[];
} {
  const targetContainer = resolveJobTemplateContainer(input.jobName, input.template);
  const overrideEnvVars: CloudJobTemplateEnvVar[] = [
    {
      name: 'ECHIDNA_HANDS_START_RUN_PAYLOAD',
      value: input.payload,
    },
    {
      name: 'ECHIDNA_HANDS_WORKER_INSTANCE_ID',
      value: input.workerInstanceId,
    },
  ];

  return {
    containers: input.template.containers.map((container) =>
      toExecutionTemplateContainer(
        container.name !== targetContainer.name
          ? container
          : {
              ...container,
            env: mergeTemplateEnvVars(container.env, overrideEnvVars),
            },
      ),
    ),
  };
}

export function createAzureContainerAppsJobLauncher(
  logger: Logger,
  dependencies: {
    credential?: {
      getToken(
        scopes: string | string[],
      ): Promise<{
        token: string;
      } | null>;
    };
    fetch?: typeof fetch;
  } = {},
): CloudHandsJobLauncher {
  const credential = dependencies.credential ?? new DefaultAzureCredential();
  const fetchFn = dependencies.fetch ?? fetch;

  return {
    async startJobExecution(input): Promise<{ dispatchReference: string }> {
      const { jobName, resourceId } = parseJobTargetResourceId(input.jobTarget);
      const token = await credential.getToken('https://management.azure.com/.default');
      if (!token) {
        throw new DependencyUnavailableError(
          'Unable to acquire an Azure management token for Hands job dispatch.',
        );
      }

      const headers = {
        authorization: `Bearer ${token.token}`,
        'content-type': 'application/json',
      };
      const getJobResponse = await fetchFn(`${createAzureResourceManagerUrl(resourceId, '')}?api-version=2024-03-01`, {
        headers,
        method: 'GET',
        signal: AbortSignal.timeout(15000),
      });
      if (!getJobResponse.ok) {
        throw new DependencyUnavailableError(await readRuntimeError(getJobResponse));
      }

      const jobPayload = (await getJobResponse.json().catch(() => null)) as
        | {
            properties?: {
              template?: CloudJobTemplate;
            };
          }
        | null;
      const template = jobPayload?.properties?.template;
      if (!template?.containers) {
        throw new DependencyUnavailableError(
          'Hands job dispatch could not read the configured Container Apps job template.',
        );
      }

      const response = await fetchFn(
        createAzureResourceManagerUrl(resourceId, '/start?api-version=2024-03-01'),
        {
          body: JSON.stringify(
            createJobExecutionTemplate({
              jobName,
              payload: input.payload,
              template,
              workerInstanceId: input.workerInstanceId,
            }),
          ),
          headers,
          method: 'POST',
          signal: AbortSignal.timeout(15000),
        },
      );

      if (!response.ok) {
        throw new DependencyUnavailableError(await readRuntimeError(response));
      }

      const payload = (await response.json().catch(() => null)) as
        | {
            id?: string;
            name?: string;
          }
        | null;
      const dispatchReference =
        payload?.name ?? payload?.id ?? `${jobName}:${input.workerInstanceId}`;
      logger.info('hands_runtime.job_dispatched', {
        dispatchReference,
        jobTarget: input.jobTarget,
      });

      return {
        dispatchReference,
      };
    },
  };
}

function sanitizeWorkerInstanceId(input: string): string {
  const normalized = input.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized === '' ? 'hands-cloud-dispatch' : normalized.slice(0, 63);
}

function createCloudHandsJobTriggerAdapter(options: {
  config: ApiRuntimeConfig;
  launcher: CloudHandsJobLauncher;
  repositories: RepositoryBundle;
}): HandsJobTriggerAdapter {
  return {
    async releaseForUser(input: HandsReleaseForUserRequest): Promise<HandsRun> {
      return releaseHandsRunForUser({
        repositories: options.repositories,
        request: input,
      });
    },
    async startRun(input: HandsStartRunRequest): Promise<HandsDispatchResult> {
      const request = handsStartRunRequestSchema.parse(input);
      const acceptedAt = new Date().toISOString();
      const workerInstanceId = sanitizeWorkerInstanceId(
        `hands-cloud-${request.taskId}-${request.attemptNumber}`,
      );
      const dispatch = await options.launcher.startJobExecution({
        jobTarget: options.config.hands.jobTarget,
        payload: JSON.stringify(request),
        workerInstanceId,
      });

      return createDispatchResult(request, acceptedAt, 'one_shot', dispatch.dispatchReference);
    },
  };
}

function createLocalHandsJobTriggerAdapter(options: {
  config: ApiRuntimeConfig;
  getTaskQueueService: () => TaskQueueGateway;
  logger: Logger;
  repositories: RepositoryBundle;
  sandboxRuntime: SandboxRuntimeAdapter;
}): HandsJobTriggerAdapter {
  const coordinator = createHandsExecutionCoordinator({
    followUpQueue: {
      enqueueFollowUpTasks: async (
        input: HandsEnqueueFollowUpRequest,
      ): Promise<{
        results: ReturnType<typeof enqueueTaskResultSchema.parse>[];
      }> => {
        const request = handsEnqueueFollowUpRequestSchema.parse(input);
        const storedWorkingContext = await options.repositories.workingContexts.get(
          request.agentId,
          request.workingContextId,
        );
        if (!storedWorkingContext) {
          throw new NotFoundError('Working context not found for follow-up task enqueue.');
        }

        return {
          results: await Promise.all(
            request.followUpTasks.map(async (task: HandsFollowUpTaskRequest) =>
              options
                .getTaskQueueService()
                .enqueueTask({
                  agentId: request.agentId,
                  correlation: request.correlation,
                  dueAt: task.dueAt,
                  externalReferences: task.externalReferences,
                  headTurnId: null,
                  lane: task.lane,
                  notes: task.notes,
                  priority: task.priority,
                  requestedBy: {
                    kind: 'system',
                  },
                  requestedOutcome: task.requestedOutcome,
                  startRequested: task.startRequested,
                  taskType: task.taskType,
                  workingContextId: request.workingContextId,
                  workingContextSummary: storedWorkingContext.value.summary,
                })
                .then((result) => enqueueTaskResultSchema.parse(result)),
            ),
          ),
        };
      },
    },
    logger: options.logger,
    repositories: {
      agents: options.repositories.agents,
      execution: options.repositories.execution,
      tasks: options.repositories.tasks,
      workingContexts: options.repositories.workingContexts,
    },
    sandbox: options.sandboxRuntime,
    workerInstanceId: `api-local-${process.pid}`,
  });

  return {
    async releaseForUser(input: HandsReleaseForUserRequest): Promise<HandsRun> {
      return releaseHandsRunForUser({
        repositories: options.repositories,
        request: input,
      });
    },
    async startRun(input: HandsStartRunRequest): Promise<HandsDispatchResult> {
      const request = handsStartRunRequestSchema.parse(input);
      const acceptedAt = new Date().toISOString();

      void coordinator.executeDispatchedRun(request).catch((error: unknown) => {
        options.logger.error('hands_runtime.local_dispatch_failed', {
          message: error instanceof Error ? error.message : 'Unknown Hands execution failure.',
          taskId: request.taskId,
        });
      });

      return createDispatchResult(
        request,
        acceptedAt,
        'in_process',
        request.dispatchIdempotencyKey,
      );
    },
  };
}

export function createRuntimeAdapters(options: {
  cloudHandsJobLauncher?: CloudHandsJobLauncher;
  config: ApiRuntimeConfig;
  getTaskQueueService: () => TaskQueueGateway;
  logger: Logger;
  repositories: RepositoryBundle;
  sandboxRuntime: SandboxRuntimeAdapter;
}): {
  health: Record<
    'handsJobs' | 'schedulerRuntime',
    {
      description: string;
      mode: 'configured_live';
      ready: true;
    }
  >;
  runtime: {
    handsJobs: HandsJobTriggerAdapter;
    schedulerRuntime: SchedulerRuntimeAdapter;
  };
} {
  const handsJobs =
    options.config.runtimeMode === 'local-minimal'
      ? createLocalHandsJobTriggerAdapter(options)
      : options.config.runtimeMode === 'shared-cloud'
        ? createHttpHandsJobTriggerAdapter({
            config: options.config,
            repositories: options.repositories,
          })
        : createCloudHandsJobTriggerAdapter({
            config: options.config,
            launcher: options.cloudHandsJobLauncher ?? createAzureContainerAppsJobLauncher(options.logger),
            repositories: options.repositories,
          });

  return {
    health: {
      handsJobs: {
        description:
          options.config.runtimeMode === 'local-minimal'
            ? 'Hands runs execute in-process against the local in-memory runtime graph.'
            : options.config.runtimeMode === 'shared-cloud'
              ? `Hands runs dispatch to ${options.config.hands.baseUrl}.`
              : `Hands runs dispatch Container Apps Job executions via ${options.config.hands.jobTarget}.`,
        mode: 'configured_live',
        ready: true,
      },
      schedulerRuntime: {
        description: 'Scheduler runtime bridge remains reserved for Step 15.',
        mode: 'configured_live',
        ready: true,
      },
    },
    runtime: {
      handsJobs,
      schedulerRuntime: {
        async processDueWork(
          _input: SchedulerProcessDueWorkRequest,
        ): Promise<SchedulerProcessDueWorkResult> {
          void _input;
          throw new NotImplementedYetError(
            'Scheduler runtime adapter is not used by the API runtime.',
          );
        },
      },
    },
  };
}

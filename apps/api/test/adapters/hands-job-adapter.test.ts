import { describe, expect, it, vi } from 'vitest';
import { createLoggerFactory } from '@echidna-claw/observability';
import { createInMemoryRepositorySuite } from '@echidna-claw/persistence';

import {
  createAzureContainerAppsJobLauncher,
  createRuntimeAdapters,
} from '../../src/adapters/jobs/index.js';
import { createTestApiConfig } from '../../src/testing/fixtures/api-config.js';

function createRepositoryBundle() {
  const suite = createInMemoryRepositorySuite();

  return {
    agents: suite.agents,
    agentRegistry: suite.agentRegistry,
    analytics: {
      async getOverview() {
        return {
          events: [],
          totalEstimatedCostUsd: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
        };
      },
    },
    approvals: {
      async getState() {
        return 'requested' as const;
      },
    },
    channels: suite.channels,
    credentials: suite.credentials,
    execution: suite.execution,
    idempotency: suite.idempotency,
    messages: suite.messages,
    runJournals: suite.runJournals,
    schedules: suite.schedules,
    tasks: suite.tasks,
    workingContexts: suite.workingContexts,
  };
}

describe('Hands job adapter', () => {
  it('merges per-execution env overrides into the existing Container Apps Job template', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            properties: {
              template: {
                containers: [
                  {
                    name: 'main',
                    image: 'acrecdeviq267.azurecr.io/echidna-claw/hands:test',
                    imageType: 'ContainerImage',
                    resources: {
                      cpu: 1,
                      memory: '2Gi',
                    },
                    env: [
                      {
                        name: 'APPLICATIONINSIGHTS_CONNECTION_STRING',
                        value: 'InstrumentationKey=test',
                      },
                    ],
                  },
                ],
              },
            },
          }),
          {
            status: 200,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            name: 'job-execution-123',
          }),
          {
            status: 200,
          },
        ),
      );
    const launcher = createAzureContainerAppsJobLauncher(
      createLoggerFactory({
        level: 'debug',
        serviceName: 'hands-job-launcher-test',
        sink: () => {},
      }).createLogger({ component: 'launcher_test' }),
      {
        credential: {
          async getToken() {
            return {
              token: 'azure-management-token',
            };
          },
        },
        fetch: fetchMock,
      },
    );

    const result = await launcher.startJobExecution({
      jobTarget:
        '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-ec-dev/providers/Microsoft.App/jobs/acj-hands-dev',
      payload: '{"taskId":"tsk_adapter-test"}',
      workerInstanceId: 'hands-cloud-tsk-adapter-test-1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://management.azure.com/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-ec-dev/providers/Microsoft.App/jobs/acj-hands-dev/?api-version=2024-03-01',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://management.azure.com/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-ec-dev/providers/Microsoft.App/jobs/acj-hands-dev/start?api-version=2024-03-01',
    );
    const startBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    expect(startBody).toMatchObject({
      containers: [
        {
          env: [
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING',
              value: 'InstrumentationKey=test',
            },
            {
              name: 'ECHIDNA_HANDS_START_RUN_PAYLOAD',
              value: '{"taskId":"tsk_adapter-test"}',
            },
            {
              name: 'ECHIDNA_HANDS_WORKER_INSTANCE_ID',
              value: 'hands-cloud-tsk-adapter-test-1',
            },
          ],
          image: 'acrecdeviq267.azurecr.io/echidna-claw/hands:test',
          name: 'main',
          resources: {
            cpu: 1,
            memory: '2Gi',
          },
        },
      ],
    });
    expect(Object.keys(startBody)).toEqual(['containers']);
    expect(startBody.containers[0]).not.toHaveProperty('imageType');
    expect(result.dispatchReference).toBe('job-execution-123');
  });

  it('dispatches Container Apps Job executions in cloud-deployed mode', async () => {
    const launchCalls: Array<{
      jobTarget: string;
      payload: string;
      workerInstanceId: string;
    }> = [];
    const runtime = createRuntimeAdapters({
      cloudHandsJobLauncher: {
        async startJobExecution(input) {
          launchCalls.push(input);
          return {
            dispatchReference: 'execution-123',
          };
        },
      },
      config: createTestApiConfig({
        hands: {
          jobTarget:
            '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-ec-dev/providers/Microsoft.App/jobs/acj-hands-dev',
        },
        runtimeMode: 'cloud-deployed',
      }),
      getTaskQueueService: () => {
        throw new Error('Task queue service should not be used by the cloud job adapter.');
      },
      logger: createLoggerFactory({
        level: 'debug',
        serviceName: 'hands-job-adapter-test',
        sink: () => {},
      }).createLogger({ component: 'adapter_test' }),
      repositories: createRepositoryBundle(),
      sandboxRuntime: {
        async closeSession() {
          throw new Error('Sandbox runtime should not be used by the cloud job adapter.');
        },
        async createSession() {
          throw new Error('Sandbox runtime should not be used by the cloud job adapter.');
        },
        async executeCommand() {
          throw new Error('Sandbox runtime should not be used by the cloud job adapter.');
        },
        async getSession() {
          throw new Error('Sandbox runtime should not be used by the cloud job adapter.');
        },
      },
    });

    const result = await runtime.runtime.handsJobs.startRun({
      agentId: 'agt_adapter-test',
      attemptNumber: 2,
      correlation: {
        idempotencyKey: 'idem_adapter-test',
        taskId: 'tsk_adapter-test',
        traceId: 'trc_adapter-test',
      },
      dispatchIdempotencyKey: 'idem_adapter-test',
      taskEnvelopeId: 'env_adapter-test',
      taskId: 'tsk_adapter-test',
    });

    expect(launchCalls).toHaveLength(1);
    expect(launchCalls[0].jobTarget).toContain('/Microsoft.App/jobs/acj-hands-dev');
    expect(JSON.parse(launchCalls[0].payload)).toMatchObject({
      dispatchIdempotencyKey: 'idem_adapter-test',
      taskEnvelopeId: 'env_adapter-test',
      taskId: 'tsk_adapter-test',
    });
    expect(launchCalls[0].workerInstanceId).toContain('tsk-adapter-test');
    expect(result).toMatchObject({
      dispatchMode: 'one_shot',
      dispatchReference: 'execution-123',
      dispatchIdempotencyKey: 'idem_adapter-test',
    });
  });
});

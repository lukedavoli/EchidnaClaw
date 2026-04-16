import { afterEach, describe, expect, it } from 'vitest';
import { createAgent, createWorkingContext } from '@echidna-claw/persistence';

import { buildApiServer } from '../../src/app.js';
import { INTERNAL_RUNTIME_AUTH_HEADER } from '../../src/http/protection.js';
import { createTestApiConfig } from '../../src/testing/fixtures/api-config.js';

const apiApps: Array<ReturnType<typeof buildApiServer>> = [];

afterEach(async () => {
  await Promise.all(apiApps.splice(0).map((app) => app.close()));
});

async function seedHandsFollowUpRouteRecords(app: ReturnType<typeof buildApiServer>) {
  const repositories = app.dependencies.adapters.repositories;

  await repositories.agents.create(
    createAgent({
      id: 'agt_hands-route-test',
      primaryChannelId: 'chn_hands-route-test',
    }),
  );
  await repositories.workingContexts.create(
    createWorkingContext({
      agentId: 'agt_hands-route-test',
      id: 'ctx_hands-route-test',
      summary: 'Hands follow-up route summary.',
      summaryUpdatedAt: '2026-04-12T00:00:00.000Z',
    }),
  );
}

describe('hands runtime routes', () => {
  it('delegates follow-up task requests to the task queue service', async () => {
    const config = createTestApiConfig();
    const app = buildApiServer(config);
    apiApps.push(app);
    await seedHandsFollowUpRouteRecords(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/internal/runtime/hands/follow-up-tasks',
      headers: {
        [INTERNAL_RUNTIME_AUTH_HEADER]: config.internalRuntime.authToken,
      },
      payload: {
        agentId: 'agt_hands-route-test',
        correlation: {
          handsRunId: 'hnd_hands-route-test',
          idempotencyKey: 'idem_hands-route-test',
          taskId: 'tsk_parent-hands-route-test',
          traceId: 'trc_hands-route-test',
        },
        followUpTasks: [
          {
            dueAt: null,
            externalReferences: [],
            lane: 'follow_up',
            notes: 'Queued from the Hands runtime follow-up route test.',
            priority: 'normal',
            requestedOutcome: 'Confirm the follow-up route enqueues queued work.',
            startRequested: false,
            taskType: 'follow_up',
          },
        ],
        handsRunId: 'hnd_hands-route-test',
        taskId: 'tsk_parent-hands-route-test',
        workingContextId: 'ctx_hands-route-test',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      results: [
        {
          disposition: 'created_new_task',
          startRequest: null,
        },
      ],
    });

    const repositories = app.dependencies.adapters.repositories;
    const openTasks = await repositories.tasks.listOpenTasks('agt_hands-route-test');
    const storedWorkingContext = await repositories.workingContexts.get(
      'agt_hands-route-test',
      'ctx_hands-route-test',
    );

    expect(openTasks).toHaveLength(1);
    expect(openTasks[0].value.type).toBe('follow_up');
    expect(openTasks[0].value.requestedOutcome).toBe(
      'Confirm the follow-up route enqueues queued work.',
    );
    expect(storedWorkingContext?.value.openTaskIds).toEqual([openTasks[0].value.id]);
    expect(storedWorkingContext?.value.activeTaskId).toBe(openTasks[0].value.id);
  });
});

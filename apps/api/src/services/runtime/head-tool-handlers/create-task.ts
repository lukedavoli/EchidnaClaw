import { z } from 'zod';

import type {
  EnqueueTaskRequest,
  HeadTurn,
  QueueLane,
  RequestedBy,
  WorkingContext,
} from '@echidna-claw/contracts';
import { isoDateTimeSchema, queuePrioritySchema } from '@echidna-claw/contracts';

const createTaskArgsSchema = z
  .object({
    dueAt: isoDateTimeSchema.optional(),
    notes: z.string().trim().default(''),
    priority: queuePrioritySchema.default('normal'),
    requestedOutcome: z.string().trim().min(1),
    taskType: z.string().trim().min(1),
  })
  .strict();

function getRequestedBy(headTurn: HeadTurn): RequestedBy {
  if (headTurn.triggerKind === 'trusted_messages') {
    return {
      kind: 'user',
      ...(headTurn.inboundMessageIds.at(-1)
        ? { sourceMessageId: headTurn.inboundMessageIds.at(-1) }
        : {}),
    };
  }

  if (headTurn.scheduleId) {
    return {
      kind: 'schedule',
      sourceScheduleId: headTurn.scheduleId,
    };
  }

  return {
    kind: 'system',
  };
}

function getQueueLane(headTurn: HeadTurn): QueueLane {
  if (headTurn.triggerKind === 'trusted_messages') {
    return 'user_requested';
  }

  if (headTurn.scheduleId) {
    return 'scheduled';
  }

  if (headTurn.taskId) {
    return 'follow_up';
  }

  return 'system';
}

export async function handleCreateTask(input: {
  args: unknown;
  headTurn: HeadTurn;
  workingContext: WorkingContext;
}): Promise<{
  deferredDirectives: [
    {
      kind: 'task_request';
      request: {
        mode: 'activate_deferred_task' | 'enqueue_task';
        request: EnqueueTaskRequest;
        taskId: string | null;
      };
    },
  ];
  effectSummaryPatch: {
    taskRequested: true;
  };
  outputText: string;
}> {
  const args = createTaskArgsSchema.parse(input.args);
  const dueAt = args.dueAt ?? null;
  const requestedAt = new Date().toISOString();
  const request: EnqueueTaskRequest = {
    agentId: input.headTurn.agentId,
    correlation: {
      ...input.headTurn.correlation,
      taskId: input.headTurn.correlation.taskId,
    },
    dueAt,
    externalReferences: [],
    headTurnId: input.headTurn.id,
    lane: getQueueLane(input.headTurn),
    notes: args.notes,
    priority: args.priority,
    requestedBy: getRequestedBy(input.headTurn),
    requestedOutcome: args.requestedOutcome,
    startRequested: true,
    taskType: args.taskType,
    workingContextId: input.workingContext.id,
    workingContextSummary: input.workingContext.summary,
  };
  const mode =
    dueAt == null || dueAt > requestedAt
      ? 'enqueue_task'
      : input.headTurn.triggerKind === 'due_task' && input.headTurn.taskId
        ? 'activate_deferred_task'
        : 'enqueue_task';

  return {
    deferredDirectives: [
      {
        kind: 'task_request',
        request: {
          mode,
          request,
          taskId: mode === 'activate_deferred_task' ? input.headTurn.taskId : null,
        },
      },
    ],
    effectSummaryPatch: {
      taskRequested: true,
    },
    outputText:
      mode === 'activate_deferred_task'
        ? 'Deferred task activation staged and will be applied if this turn remains current.'
        : dueAt != null && dueAt > requestedAt
          ? 'Deferred task request staged and will remain pending until its due time if this turn remains current.'
          : 'Queued task request staged and Hands startup will be requested if this turn remains current.',
  };
}

import { z } from 'zod';

import type {
  HeadTurn,
  QueueLane,
  RequestedBy,
  WorkingContext,
} from '@echidna-claw/contracts';
import { isoDateTimeSchema, queuePrioritySchema } from '@echidna-claw/contracts';

import type { TaskQueueService } from '../task-queue-service.js';

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

function formatLaunchSummary(result: Awaited<ReturnType<TaskQueueService['enqueueTask']>>): string {
  if (result.taskState === 'deferred') {
    return 'The task is waiting until its due time; no Hands startup request was issued.';
  }

  if (!result.startRequest) {
    return 'No Hands startup request was issued.';
  }

  if (result.startRequest.adapterAccepted) {
    return result.startRequest.replayed
      ? 'Hands startup was already requested for this envelope.'
      : 'Hands startup was requested.';
  }

  return result.startRequest.errorMessage
    ? `Hands startup is pending later runtime support: ${result.startRequest.errorMessage}`
    : 'Hands startup is pending later runtime support.';
}

export async function handleCreateTask(input: {
  args: unknown;
  headTurn: HeadTurn;
  taskQueueService: TaskQueueService;
  workingContext: WorkingContext;
}): Promise<{
  effectSummaryPatch: {
    taskRequested: true;
  };
  outputText: string;
}> {
  const args = createTaskArgsSchema.parse(input.args);
  const dueAt = args.dueAt ?? null;
  const requestedAt = new Date().toISOString();
  const request = {
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
  const result =
    dueAt == null || dueAt > requestedAt
      ? await input.taskQueueService.enqueueTask(request)
      : input.headTurn.triggerKind === 'due_task' && input.headTurn.taskId
        ? await input.taskQueueService.activateDeferredTask({
            ...request,
            taskId: input.headTurn.taskId,
          })
        : await input.taskQueueService.enqueueTask(request);

  return {
    effectSummaryPatch: {
      taskRequested: true,
    },
    outputText: [
      `Task ${result.taskId} ${result.disposition.replaceAll('_', ' ')} as ${result.taskState}.`,
      formatLaunchSummary(result),
    ].join(' '),
  };
}

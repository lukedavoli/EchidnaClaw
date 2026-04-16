import type {
  HandsDispatchResult,
  HandsEnqueueFollowUpRequest,
  HandsEnqueueFollowUpResult,
  HandsReleaseForUserRequest,
  HandsRun,
  HandsService,
  HandsStartRunRequest,
} from '@echidna-claw/contracts';
import { handsEnqueueFollowUpRequestSchema } from '@echidna-claw/contracts';
import type { Logger } from '@echidna-claw/observability';

import type { HandsJobTriggerAdapter } from '../../adapters/jobs/index.js';
import type { RepositoryBundle } from '../../adapters/repositories/index.js';
import { NotFoundError } from '../../http/errors.js';
import type { TaskQueueService } from './task-queue-service.js';

export function createHandsRuntimeService(options: {
  handsJobs: HandsJobTriggerAdapter;
  logger: Logger;
  repositories: RepositoryBundle;
  taskQueueService: TaskQueueService;
}): HandsService {
  return {
    async enqueueFollowUpTasks(
      input: HandsEnqueueFollowUpRequest,
    ): Promise<HandsEnqueueFollowUpResult> {
      const request = handsEnqueueFollowUpRequestSchema.parse(input);
      const storedWorkingContext = await options.repositories.workingContexts.get(
        request.agentId,
        request.workingContextId,
      );
      if (!storedWorkingContext) {
        throw new NotFoundError('Working context not found.');
      }
      const status = await Promise.all(
        request.followUpTasks.map((task) =>
          options.taskQueueService.enqueueTask({
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
          }),
        ),
      );

      return {
        results: status,
      };
    },
    async releaseForUser(input: HandsReleaseForUserRequest): Promise<HandsRun> {
      options.logger.info('hands_runtime.release_for_user', {
        approvalId: input.approvalId,
        handsRunId: input.handsRunId,
      });
      return options.handsJobs.releaseForUser(input);
    },
    async startRun(input: HandsStartRunRequest): Promise<HandsDispatchResult> {
      options.logger.info('hands_runtime.start_run', { taskId: input.taskId });
      return options.handsJobs.startRun(input);
    },
  };
}

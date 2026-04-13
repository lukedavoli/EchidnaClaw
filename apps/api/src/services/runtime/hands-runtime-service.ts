import type {
  HandsReleaseForUserRequest,
  HandsRun,
  HandsService,
  HandsStartRunRequest,
  Task,
} from '@echidna-claw/contracts';
import type { Logger } from '@echidna-claw/observability';

import type { HandsJobTriggerAdapter } from '../../adapters/jobs/index.js';
import { NotImplementedYetError } from '../../http/errors.js';

export function createHandsRuntimeService(options: {
  handsJobs: HandsJobTriggerAdapter;
  logger: Logger;
}): HandsService {
  return {
    async completeTask(_task: Task): Promise<Task> {
      throw new NotImplementedYetError('Hands task completion is reserved for Step 13.');
    },
    async releaseForUser(input: HandsReleaseForUserRequest): Promise<HandsRun> {
      options.logger.info('hands_runtime.release_for_user', {
        approvalId: input.approvalId,
        handsRunId: input.handsRunId,
      });
      return options.handsJobs.releaseForUser(input);
    },
    async startRun(input: HandsStartRunRequest): Promise<HandsRun> {
      options.logger.info('hands_runtime.start_run', { taskId: input.taskId });
      return options.handsJobs.startRun(input);
    },
  };
}

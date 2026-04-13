import type {
  SchedulerMaterializeDueSchedulesRequest,
  SchedulerService,
  Task,
} from '@echidna-claw/contracts';
import type { Logger } from '@echidna-claw/observability';

import type { SchedulerRuntimeAdapter } from '../../adapters/jobs/index.js';

export function createSchedulerRuntimeService(options: {
  logger: Logger;
  schedulerRuntime: SchedulerRuntimeAdapter;
}): SchedulerService {
  return {
    async materializeDueSchedules(
      input: SchedulerMaterializeDueSchedulesRequest,
    ): Promise<Task[]> {
      options.logger.info('scheduler_runtime.materialize_due_schedules', { asOf: input.asOf });
      return options.schedulerRuntime.materializeDueSchedules(input);
    },
  };
}

import type {
  HandsReleaseForUserRequest,
  HandsRun,
  HandsStartRunRequest,
  SchedulerMaterializeDueSchedulesRequest,
  Task,
} from '@echidna-claw/contracts';

import { NotImplementedYetError } from '../../http/errors.js';

export interface HandsJobTriggerAdapter {
  releaseForUser(input: HandsReleaseForUserRequest): Promise<HandsRun>;
  startRun(input: HandsStartRunRequest): Promise<HandsRun>;
}

export interface SchedulerRuntimeAdapter {
  materializeDueSchedules(input: SchedulerMaterializeDueSchedulesRequest): Promise<Task[]>;
}

export function createRuntimeAdapters(mode: 'stubbed' | 'configured_placeholder'): {
  health: Record<
    'handsJobs' | 'schedulerRuntime',
    {
      description: string;
      mode: 'stubbed' | 'configured_placeholder';
      ready: true;
    }
  >;
  runtime: {
    handsJobs: HandsJobTriggerAdapter;
    schedulerRuntime: SchedulerRuntimeAdapter;
  };
} {
  const modeDescription =
    mode === 'stubbed'
      ? 'Stubbed runtime adapter for local-minimal startup.'
      : 'Config is present; the real runtime adapter is reserved for later steps.';

  return {
    health: {
      handsJobs: {
        description: `Hands job trigger: ${modeDescription}`,
        mode,
        ready: true,
      },
      schedulerRuntime: {
        description: `Scheduler runtime bridge: ${modeDescription}`,
        mode,
        ready: true,
      },
    },
    runtime: {
      handsJobs: {
        async releaseForUser(_input: HandsReleaseForUserRequest): Promise<HandsRun> {
          void _input;
          throw new NotImplementedYetError('Hands release-for-user is reserved for Step 13.');
        },
        async startRun(_input: HandsStartRunRequest): Promise<HandsRun> {
          void _input;
          throw new NotImplementedYetError('Hands job starts are reserved for Step 13.');
        },
      },
      schedulerRuntime: {
        async materializeDueSchedules(
          _input: SchedulerMaterializeDueSchedulesRequest,
        ): Promise<Task[]> {
          void _input;
          throw new NotImplementedYetError(
            'Schedule materialization is reserved for Step 15.',
          );
        },
      },
    },
  };
}

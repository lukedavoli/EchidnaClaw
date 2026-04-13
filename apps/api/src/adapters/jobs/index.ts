import type {
  HandsReleaseForUserRequest,
  HandsRun,
  HandsStartRunRequest,
  SandboxCreateSessionRequest,
  SandboxSession,
  SchedulerMaterializeDueSchedulesRequest,
  Task,
} from '@echidna-claw/contracts';

import { NotImplementedYetError } from '../../http/errors.js';

export interface HandsJobTriggerAdapter {
  releaseForUser(input: HandsReleaseForUserRequest): Promise<HandsRun>;
  startRun(input: HandsStartRunRequest): Promise<HandsRun>;
}

export interface SandboxRuntimeAdapter {
  createSession(input: SandboxCreateSessionRequest): Promise<SandboxSession>;
}

export interface SchedulerRuntimeAdapter {
  materializeDueSchedules(input: SchedulerMaterializeDueSchedulesRequest): Promise<Task[]>;
}

export function createRuntimeAdapters(mode: 'stubbed' | 'configured-placeholder'): {
  health: Record<
    'handsJobs' | 'sandboxRuntime' | 'schedulerRuntime',
    {
      description: string;
      mode: 'stubbed' | 'configured-placeholder';
      ready: true;
    }
  >;
  runtime: {
    handsJobs: HandsJobTriggerAdapter;
    sandboxRuntime: SandboxRuntimeAdapter;
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
      sandboxRuntime: {
        description: `Sandbox runtime bridge: ${modeDescription}`,
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
          throw new NotImplementedYetError('Hands release-for-user is reserved for Step 13.');
        },
        async startRun(_input: HandsStartRunRequest): Promise<HandsRun> {
          throw new NotImplementedYetError('Hands job starts are reserved for Step 13.');
        },
      },
      sandboxRuntime: {
        async createSession(_input: SandboxCreateSessionRequest): Promise<SandboxSession> {
          throw new NotImplementedYetError('Sandbox session creation is reserved for Step 14.');
        },
      },
      schedulerRuntime: {
        async materializeDueSchedules(
          _input: SchedulerMaterializeDueSchedulesRequest,
        ): Promise<Task[]> {
          throw new NotImplementedYetError(
            'Schedule materialization is reserved for Step 15.',
          );
        },
      },
    },
  };
}

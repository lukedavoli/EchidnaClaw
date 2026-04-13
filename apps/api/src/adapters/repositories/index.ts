import type {
  Agent,
  AnalyticsOverview,
  ApprovalId,
  ApprovalState,
  WebCreateAgentRequest,
  WebRestoreAgentRequest,
  WebSoftDeleteAgentRequest,
} from '@echidna-claw/contracts';

import { NotImplementedYetError } from '../../http/errors.js';

export interface RepositoryBundle {
  agents: {
    create(input: WebCreateAgentRequest): Promise<Agent>;
    list(): Promise<Agent[]>;
    restore(input: WebRestoreAgentRequest): Promise<Agent>;
    softDelete(input: WebSoftDeleteAgentRequest): Promise<Agent>;
  };
  analytics: {
    getOverview(): Promise<AnalyticsOverview>;
  };
  approvals: {
    getState(approvalId: ApprovalId): Promise<ApprovalState>;
  };
}

export function createRepositoryBundle(mode: 'stubbed' | 'configured-placeholder'): {
  health: {
    description: string;
    mode: 'stubbed' | 'configured-placeholder';
    ready: true;
  };
  repositories: RepositoryBundle;
} {
  return {
    health: {
      description:
        mode === 'stubbed'
          ? 'Repository adapters are stubbed until the Step 5 persistence layer is wired in.'
          : 'Repository config is present; Cosmos-backed implementations are reserved for Step 5.',
      mode,
      ready: true,
    },
    repositories: {
      agents: {
        async create(_input: WebCreateAgentRequest): Promise<Agent> {
          throw new NotImplementedYetError('Agent persistence is reserved for Step 5.');
        },
        async list(): Promise<Agent[]> {
          throw new NotImplementedYetError('Agent persistence is reserved for Step 5.');
        },
        async restore(_input: WebRestoreAgentRequest): Promise<Agent> {
          throw new NotImplementedYetError('Agent restoration is reserved for Step 5.');
        },
        async softDelete(_input: WebSoftDeleteAgentRequest): Promise<Agent> {
          throw new NotImplementedYetError('Agent soft-delete is reserved for Step 5.');
        },
      },
      analytics: {
        async getOverview(): Promise<AnalyticsOverview> {
          throw new NotImplementedYetError('Analytics aggregation is reserved for Step 18.');
        },
      },
      approvals: {
        async getState(_approvalId: ApprovalId): Promise<ApprovalState> {
          throw new NotImplementedYetError('Approval persistence is reserved for Step 16.');
        },
      },
    },
  };
}

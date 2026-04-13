import type { AnalyticsOverview, ApprovalId, ApprovalState } from '@echidna-claw/contracts';
import {
  createAzureRepositorySuite,
  createInMemoryRepositorySuite,
  type AgentRegistryRepository,
} from '@echidna-claw/persistence';

import type { ApiRuntimeConfig } from '../../config/api-runtime-config.js';
import { NotImplementedYetError } from '../../http/errors.js';

export interface RepositoryBundle {
  agentRegistry: AgentRegistryRepository;
  analytics: {
    getOverview(): Promise<AnalyticsOverview>;
  };
  approvals: {
    getState(approvalId: ApprovalId): Promise<ApprovalState>;
  };
}

export function createRepositoryBundle(config: ApiRuntimeConfig): {
  health: {
    description: string;
    mode: 'configured_live' | 'in_memory';
    ready: true;
  };
  repositories: RepositoryBundle;
} {
  const suite =
    config.runtimeMode === 'local-minimal'
      ? createInMemoryRepositorySuite()
      : (() => {
          if (!config.sharedCloud) {
            throw new Error('Shared-cloud repository configuration is required outside local-minimal mode.');
          }

          return createAzureRepositorySuite({
            artifactsContainerName: config.sharedCloud.blobStorage.artifactsContainer,
            blobAccountUrl: config.sharedCloud.blobStorage.accountUrl,
            cosmosDatabaseName: config.sharedCloud.cosmosDb.databaseName,
            cosmosEndpoint: config.sharedCloud.cosmosDb.endpoint,
            keyEncryptionKeyId: config.sharedCloud.keyVault.keyId,
          });
        })();

  return {
    health: {
      description:
        config.runtimeMode === 'local-minimal'
          ? 'Repository adapters use the in-memory suite for local-minimal development.'
          : 'Repository adapters are configured against the shared Azure persistence dependencies.',
      mode: config.runtimeMode === 'local-minimal' ? 'in_memory' : 'configured_live',
      ready: true,
    },
    repositories: {
      agentRegistry: suite.agentRegistry,
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

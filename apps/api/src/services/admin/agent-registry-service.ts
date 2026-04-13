import type {
  AdminAgentDetail,
  AdminAgentSummary,
  CompleteAgentProvisioningRequest,
  RepositoryConfig,
  WebCreateAgentRequest,
  WebRestoreAgentRequest,
  WebRetryAgentProvisioningRequest,
  WebSoftDeleteAgentRequest,
  RecordAgentProvisioningFailureRequest,
} from '@echidna-claw/contracts';
import {
  completeAgentProvisioning as completeAgentProvisioningLifecycle,
  createAgentRegistryRecords,
  createTelegramConversationUrl,
  recordAgentProvisioningFailure as recordAgentProvisioningFailureLifecycle,
  resetAgentProvisioningForRetry,
  restoreAgent as restoreAgentLifecycle,
  softDeleteAgent as softDeleteAgentLifecycle,
} from '@echidna-claw/domain';
import type { Logger } from '@echidna-claw/observability';
import {
  DuplicateRecordError,
  type AgentRegistryEntry,
  type WritableAgentRegistryEntry,
  RecordConflictError,
  RecordNotFoundError,
} from '@echidna-claw/persistence';

import type { RepositoryBundle } from '../../adapters/repositories/index.js';
import {
  ConflictError,
  DependencyUnavailableError,
  HttpError,
  NotFoundError,
} from '../../http/errors.js';

function now(): string {
  return new Date().toISOString();
}

function touchPrimaryChannel<TChannel extends NonNullable<AgentRegistryEntry['primaryChannel']>>(
  primaryChannel: TChannel,
  updatedAt: string,
) {
  return {
    ...primaryChannel.value,
    updatedAt,
  };
}

function toAdminAgentSummary(entry: AgentRegistryEntry): AdminAgentSummary {
  return {
    agent: entry.agent.value,
    primaryChannel: entry.primaryChannel
      ? {
          id: entry.primaryChannel.value.id,
          provider: entry.primaryChannel.value.provider,
          state: entry.primaryChannel.value.state,
          externalHandle: entry.primaryChannel.value.externalHandle,
          externalChatId: entry.primaryChannel.value.externalChatId,
          botUserId: entry.primaryChannel.value.botUserId,
          botDisplayName: entry.primaryChannel.value.botDisplayName,
          credentialId: entry.primaryChannel.value.credentialId,
          provisioningRequestedAt: entry.primaryChannel.value.provisioningRequestedAt,
          provisioningStartedAt: entry.primaryChannel.value.provisioningStartedAt,
          boundAt: entry.primaryChannel.value.boundAt,
          lastProvisioningFailedAt: entry.primaryChannel.value.lastProvisioningFailedAt,
          lastProvisioningErrorCode: entry.primaryChannel.value.lastProvisioningErrorCode,
          lastProvisioningErrorMessage: entry.primaryChannel.value.lastProvisioningErrorMessage,
          recoveryAttemptCount: entry.primaryChannel.value.recoveryAttemptCount,
          lastRecoveryRequestedAt: entry.primaryChannel.value.lastRecoveryRequestedAt,
          conversationUrl: createTelegramConversationUrl(entry.primaryChannel.value.externalHandle),
        }
      : null,
  };
}

function requirePrimaryChannel(entry: AgentRegistryEntry): {
  agent: AgentRegistryEntry['agent'];
  primaryChannel: NonNullable<AgentRegistryEntry['primaryChannel']>;
} {
  if (!entry.primaryChannel) {
    throw new HttpError(
      500,
      'broken_registry_invariant',
      `Primary channel is missing for agent '${entry.agent.value.id}'.`,
    );
  }

  return {
    agent: entry.agent,
    primaryChannel: entry.primaryChannel,
  };
}

function toAdminAgentDetail(entry: AgentRegistryEntry): AdminAgentDetail {
  return toAdminAgentSummary(requirePrimaryChannel(entry));
}

function mapRegistryError(error: unknown): Error {
  if (error instanceof NotFoundError || error instanceof ConflictError || error instanceof HttpError) {
    return error;
  }

  if (error instanceof RecordNotFoundError) {
    return new NotFoundError('Agent not found.');
  }

  if (error instanceof RecordConflictError) {
    return new ConflictError('The agent registry changed while the request was in progress.');
  }

  return new DependencyUnavailableError('The agent registry is currently unavailable.', {
    cause: error,
  });
}

export interface AgentRegistryService {
  completeAgentProvisioning(input: CompleteAgentProvisioningRequest): Promise<AdminAgentDetail>;
  createAgent(input: WebCreateAgentRequest): Promise<AdminAgentDetail>;
  getAgent(agentId: string): Promise<AdminAgentDetail>;
  listAgents(): Promise<AdminAgentSummary[]>;
  recordAgentProvisioningFailure(input: RecordAgentProvisioningFailureRequest): Promise<AdminAgentDetail>;
  restoreAgent(input: WebRestoreAgentRequest): Promise<AdminAgentDetail>;
  retryAgentProvisioning(input: WebRetryAgentProvisioningRequest): Promise<AdminAgentDetail>;
  softDeleteAgent(input: WebSoftDeleteAgentRequest): Promise<AdminAgentDetail>;
}

export function createAgentRegistryService(options: {
  logger: Logger;
  repositories: RepositoryBundle;
  repositoryConfig: RepositoryConfig;
}): AgentRegistryService {
  async function getExistingEntry(agentId: string): Promise<AgentRegistryEntry> {
    const existingEntry = await options.repositories.agentRegistry.getRegistryEntry(agentId);
    if (!existingEntry) {
      throw new NotFoundError('Agent not found.');
    }

    return existingEntry;
  }

  async function replaceEntry(input: WritableAgentRegistryEntry, operation: 'complete' | 'failure' | 'restore' | 'retry' | 'soft_delete') {
    switch (operation) {
      case 'complete':
        return options.repositories.agentRegistry.completeProvisioning(input);
      case 'failure':
        return options.repositories.agentRegistry.recordProvisioningFailure(input);
      case 'restore':
        return options.repositories.agentRegistry.restore(input);
      case 'retry':
        return options.repositories.agentRegistry.retryProvisioning(input);
      case 'soft_delete':
        return options.repositories.agentRegistry.softDelete(input);
    }
  }

  return {
    async createAgent(input: WebCreateAgentRequest): Promise<AdminAgentDetail> {
      const createdAt = now();
      const records = createAgentRegistryRecords({
        correlation: input.correlation,
        createdAt,
        name: input.name,
        repositoryConfig: options.repositoryConfig,
        ...(input.timeZone ? { timeZone: input.timeZone } : {}),
      });

      try {
        const existingEntry = await options.repositories.agentRegistry.getRegistryEntry(records.agent.id);
        if (existingEntry) {
          return toAdminAgentDetail(existingEntry);
        }

        return toAdminAgentDetail(
          await options.repositories.agentRegistry.createRegistryEntry(records),
        );
      } catch (error) {
        if (error instanceof DuplicateRecordError) {
          const existingEntry = await options.repositories.agentRegistry.getRegistryEntry(records.agent.id);
          if (existingEntry) {
            options.logger.warn('agent_registry.create_agent.replayed', {
              agentId: existingEntry.agent.value.id,
            });
            return toAdminAgentDetail(existingEntry);
          }
        }

        throw mapRegistryError(error);
      }
    },

    async getAgent(agentId: string): Promise<AdminAgentDetail> {
      try {
        return toAdminAgentDetail(await getExistingEntry(agentId));
      } catch (error) {
        throw mapRegistryError(error);
      }
    },

    async listAgents(): Promise<AdminAgentSummary[]> {
      try {
        return (await options.repositories.agentRegistry.listRegistryEntries()).map(toAdminAgentSummary);
      } catch (error) {
        throw mapRegistryError(error);
      }
    },

    async softDeleteAgent(input: WebSoftDeleteAgentRequest): Promise<AdminAgentDetail> {
      try {
        const existingEntry = requirePrimaryChannel(await getExistingEntry(input.agentId));
        if (existingEntry.agent.value.lifecycleState === 'soft_deleted') {
          return toAdminAgentDetail(existingEntry);
        }

        const deletedAt = now();
        return toAdminAgentDetail(
          await replaceEntry(
            {
              agent: softDeleteAgentLifecycle(existingEntry.agent.value, deletedAt),
              agentEtag: existingEntry.agent.etag,
              primaryChannel: touchPrimaryChannel(existingEntry.primaryChannel, deletedAt),
              primaryChannelEtag: existingEntry.primaryChannel.etag,
            },
            'soft_delete',
          ),
        );
      } catch (error) {
        throw mapRegistryError(error);
      }
    },

    async restoreAgent(input: WebRestoreAgentRequest): Promise<AdminAgentDetail> {
      try {
        const existingEntry = requirePrimaryChannel(await getExistingEntry(input.agentId));
        if (existingEntry.agent.value.lifecycleState === 'active') {
          return toAdminAgentDetail(existingEntry);
        }

        const restoredAt = now();
        return toAdminAgentDetail(
          await replaceEntry(
            {
              agent: restoreAgentLifecycle(existingEntry.agent.value, restoredAt),
              agentEtag: existingEntry.agent.etag,
              primaryChannel: touchPrimaryChannel(existingEntry.primaryChannel, restoredAt),
              primaryChannelEtag: existingEntry.primaryChannel.etag,
            },
            'restore',
          ),
        );
      } catch (error) {
        throw mapRegistryError(error);
      }
    },

    async retryAgentProvisioning(
      input: WebRetryAgentProvisioningRequest,
    ): Promise<AdminAgentDetail> {
      try {
        const existingEntry = requirePrimaryChannel(await getExistingEntry(input.agentId));
        if (existingEntry.agent.value.lifecycleState === 'soft_deleted') {
          throw new ConflictError('Retry provisioning is unavailable for archived agents.');
        }

        if (
          existingEntry.agent.value.provisioningState !== 'provisioning_failed' ||
          existingEntry.primaryChannel.value.state !== 'provisioning_failed'
        ) {
          throw new ConflictError(
            'Retry provisioning requires an agent whose primary channel is in provisioning_failed.',
          );
        }

        const requestedAt = now();
        const resetEntry = resetAgentProvisioningForRetry({
          agent: existingEntry.agent.value,
          primaryChannel: existingEntry.primaryChannel.value,
          requestedAt,
        });

        return toAdminAgentDetail(
          await replaceEntry(
            {
              agent: resetEntry.agent,
              agentEtag: existingEntry.agent.etag,
              primaryChannel: resetEntry.primaryChannel,
              primaryChannelEtag: existingEntry.primaryChannel.etag,
            },
            'retry',
          ),
        );
      } catch (error) {
        throw mapRegistryError(error);
      }
    },

    async completeAgentProvisioning(
      input: CompleteAgentProvisioningRequest,
    ): Promise<AdminAgentDetail> {
      try {
        const existingEntry = requirePrimaryChannel(await getExistingEntry(input.agentId));
        const completed = completeAgentProvisioningLifecycle({
          agent: existingEntry.agent.value,
          boundAt: input.boundAt ?? now(),
          primaryChannel: existingEntry.primaryChannel.value,
          botUserId: input.botUserId,
          ...(input.botDisplayName ? { botDisplayName: input.botDisplayName } : {}),
          ...(input.credentialId ? { credentialId: input.credentialId } : {}),
          ...(input.externalChatId ? { externalChatId: input.externalChatId } : {}),
          ...(input.externalHandle ? { externalHandle: input.externalHandle } : {}),
        });

        return toAdminAgentDetail(
          await replaceEntry(
            {
              agent: completed.agent,
              agentEtag: existingEntry.agent.etag,
              primaryChannel: completed.primaryChannel,
              primaryChannelEtag: existingEntry.primaryChannel.etag,
            },
            'complete',
          ),
        );
      } catch (error) {
        throw mapRegistryError(error);
      }
    },

    async recordAgentProvisioningFailure(
      input: RecordAgentProvisioningFailureRequest,
    ): Promise<AdminAgentDetail> {
      try {
        const existingEntry = requirePrimaryChannel(await getExistingEntry(input.agentId));
        const failed = recordAgentProvisioningFailureLifecycle({
          agent: existingEntry.agent.value,
          primaryChannel: existingEntry.primaryChannel.value,
          failedAt: input.failedAt ?? now(),
          ...(input.errorCode ? { errorCode: input.errorCode } : {}),
          ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
        });

        return toAdminAgentDetail(
          await replaceEntry(
            {
              agent: failed.agent,
              agentEtag: existingEntry.agent.etag,
              primaryChannel: failed.primaryChannel,
              primaryChannelEtag: existingEntry.primaryChannel.etag,
            },
            'failure',
          ),
        );
      } catch (error) {
        throw mapRegistryError(error);
      }
    },
  };
}

import { randomBytes } from 'node:crypto';

import type {
  AdminCredentialSummary,
  CorrelationMetadata,
  CredentialCapture,
  CredentialRef,
  HeadTurn,
  RepositoryConfig,
  RunJournal,
  RunJournalEntry,
  SandboxCredentialBinding,
  Task,
  WorkingContext,
} from '@echidna-claw/contracts';
import {
  createQueuedTaskProgressSummary,
  createSandboxCredentialBindings,
  resetTaskLaunchState,
  resolveCredentialService,
  transitionTaskState,
  withTaskProgressSummary,
} from '@echidna-claw/domain';
import type { Logger } from '@echidna-claw/observability';

import type { RepositoryBundle } from '../../adapters/repositories/index.js';
import { ConflictError, NotFoundError } from '../../http/errors.js';
import type { OutboundMessagingService } from '../channel/contracts.js';
import type { HandsService } from '@echidna-claw/contracts';
import type { TaskQueueService } from './task-queue-service.js';

function now(): string {
  return new Date().toISOString();
}

function createRuntimeIdentifier(prefix: 'ccp' | 'crd' | 'rje'): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

function appendUnique<TValue>(values: readonly TValue[], nextValue: TValue): TValue[] {
  return values.includes(nextValue) ? [...values] : [...values, nextValue];
}

function removeValue<TValue>(values: readonly TValue[], target: TValue): TValue[] {
  return values.filter((value) => value !== target);
}

async function loadRunJournal(
  repositories: RepositoryBundle,
  task: Task,
): Promise<Awaited<ReturnType<RepositoryBundle['runJournals']['getJournal']>> | null> {
  if (task.currentRunJournalId) {
    return repositories.runJournals.getJournal(task.agentId, task.currentRunJournalId);
  }

  return repositories.runJournals.getLatestJournalForTask(task.agentId, task.id);
}

function buildWaitingProgressSummary(input: {
  displayName: string;
  reason: string;
  task: Task;
}): Task['progressSummary'] {
  return {
    headline: `Waiting for credential: ${input.displayName}`,
    detail: input.reason,
    waitingForUser: true,
    lastActor: input.task.state === 'running' ? 'hands' : 'head',
  };
}

function buildCapturePrompt(input: {
  displayName: string;
  reason: string;
  storageNotice: string;
}): string {
  return [
    `Credential needed: ${input.displayName}`,
    `Why: ${input.reason}`,
    `Storage: ${input.storageNotice}`,
    'Reply in this chat with the credential value. Send "cancel" to stop.',
  ].join('\n');
}

function buildCompletionMessage(displayName: string): string {
  return `Credential stored: ${displayName}.`;
}

function buildCancellationMessage(displayName: string): string {
  return `Credential capture cancelled: ${displayName}.`;
}

function toAdminCredentialSummary(credential: CredentialRef): AdminCredentialSummary {
  return {
    accessPolicyRef: credential.accessPolicyRef,
    alias: credential.alias,
    credentialId: credential.id,
    displayName: credential.displayName ?? `${credential.provider}:${credential.alias}`,
    expiresAt: credential.expiresAt,
    lastRotatedAt: credential.lastRotatedAt,
    lastUsedAt: credential.lastUsedAt,
    provider: credential.provider,
    replacedByCredentialId: credential.replacedByCredentialId,
    revokedAt: credential.revokedAt,
    status: credential.status,
  };
}

export interface CredentialLifecycleService {
  completePendingCaptureFromTrustedInput(input: {
    agentId: string;
    channelId: string;
    correlation: HeadTurn['correlation'];
    inboundMessageId: string;
    plaintext: string;
  }): Promise<{ handled: boolean }>;
  getPendingRequestedCapture(agentId: string): Promise<CredentialCapture | null>;
  listCredentialSummaries(agentId: string): Promise<AdminCredentialSummary[]>;
  requestCapture(input: {
    agentId: string;
    channelId: string;
    correlation: HeadTurn['correlation'];
    reason?: string;
    serviceAlias: string;
    taskId?: string | null;
  }): Promise<CredentialCapture>;
  resolveSandboxBindings(input: {
    agentId: string;
    credentialAliases: string[];
  }): Promise<SandboxCredentialBinding[]>;
  upsertAgentCredentialFromPlaintext(input: {
    agentId: string;
    alias: string;
    channelId?: string;
    correlation: CorrelationMetadata;
    displayName?: string;
    plaintext: string;
  }): Promise<CredentialRef>;
  revokeCredential(input: {
    agentId: string;
    correlation: CorrelationMetadata;
    credentialId: string;
  }): Promise<AdminCredentialSummary>;
}

export function createCredentialLifecycleService(options: {
  handsRuntimeService: HandsService;
  logger: Logger;
  outboundMessagingService: OutboundMessagingService;
  repositories: RepositoryBundle;
  repositoryConfig: RepositoryConfig;
  taskQueueService: TaskQueueService;
}): CredentialLifecycleService {
  async function maybeAttachTelegramCredentialToChannel(input: {
    channelId: string;
    credentialId: string;
    existingCredentialId: string | undefined;
    agentId: string;
  }): Promise<void> {
    const service = resolveCredentialService(options.repositoryConfig, 'telegram-bot-token');
    if (service.provider !== 'telegram') {
      return;
    }

    const storedChannel = await options.repositories.channels.get(input.agentId, input.channelId);
    if (!storedChannel) {
      return;
    }

    if (
      storedChannel.value.credentialId &&
      storedChannel.value.credentialId !== input.existingCredentialId
    ) {
      return;
    }

    await options.repositories.channels.replace(
      {
        ...storedChannel.value,
        credentialId: input.credentialId,
        updatedAt: now(),
      },
      storedChannel.etag,
      );
  }

  async function upsertCredentialFromPlaintext(input: {
    agentId: string;
    alias: string;
    channelId?: string;
    correlation: CorrelationMetadata;
    displayName?: string;
    plaintext: string;
  }): Promise<CredentialRef> {
    const completedAt = now();
    const service = resolveCredentialService(options.repositoryConfig, input.alias);
    const existingCredential = await options.repositories.credentials.findByAlias(
      input.agentId,
      service.provider,
      service.alias,
    );

    const storedCredentialRef = existingCredential
      ? await options.repositories.credentials
          .rotateCredential({
            credentialRef: {
              ...existingCredential.value,
              displayName: input.displayName ?? existingCredential.value.displayName ?? service.displayName,
              status: 'active',
              lastRotatedAt: completedAt,
              revokedAt: null,
              replacedByCredentialId: null,
              updatedAt: completedAt,
            },
            expectedCredentialRefEtag: existingCredential.etag,
            plaintext: input.plaintext,
          })
          .then((result) => result.credentialRef)
      : await options.repositories.credentials
          .createCredential({
            credentialRef: {
              id: createRuntimeIdentifier('crd') as CredentialRef['id'],
              recordType: 'credential_ref',
              schemaVersion: 1,
              createdAt: completedAt,
              updatedAt: completedAt,
              correlation: input.correlation,
              agentId: input.agentId,
              provider: service.provider,
              alias: service.alias,
              displayName: input.displayName ?? service.displayName,
              scope: 'agent',
              status: 'active',
              accessPolicyRef: service.accessPolicyRef,
              encryptionKeyRef: 'platform://credential-envelope-key',
              lastRotatedAt: completedAt,
              lastUsedAt: null,
              revokedAt: null,
              replacedByCredentialId: null,
              expiresAt: null,
            },
            plaintext: input.plaintext,
          })
          .then((result) => result.credentialRef);

    if (input.channelId && service.alias === 'telegram-bot-token') {
      await maybeAttachTelegramCredentialToChannel({
        agentId: input.agentId,
        channelId: input.channelId,
        credentialId: storedCredentialRef.value.id,
        existingCredentialId: existingCredential?.value.id,
      });
    }

    return storedCredentialRef.value;
  }

  return {
    async getPendingRequestedCapture(agentId: string): Promise<CredentialCapture | null> {
      return (await options.repositories.credentialCaptures.findPendingByAgent(agentId))?.value ?? null;
    },

    async listCredentialSummaries(agentId: string): Promise<AdminCredentialSummary[]> {
      const credentials = await options.repositories.credentials.listByAgent(agentId);
      return credentials.map((credential) => toAdminCredentialSummary(credential.value));
    },

    async requestCapture(input): Promise<CredentialCapture> {
      const requestedAt = now();
      const service = resolveCredentialService(options.repositoryConfig, input.serviceAlias);
      const storedTask =
        input.taskId != null
          ? await options.repositories.tasks.getTask(input.agentId, input.taskId)
          : null;

      if (input.taskId != null && !storedTask) {
        throw new NotFoundError(`Task '${input.taskId}' was not found.`);
      }

      if (storedTask?.value.activeCredentialCaptureId) {
        const existingCapture = await options.repositories.credentialCaptures.get(
          input.agentId,
          storedTask.value.activeCredentialCaptureId,
        );
        if (existingCapture?.value.state === 'requested') {
          return existingCapture.value;
        }
      }

      if (storedTask && !['queued', 'running'].includes(storedTask.value.state)) {
        throw new ConflictError(
          'Only queued or running tasks can request a blocking credential capture.',
        );
      }

      const pendingForAgent = await options.repositories.credentialCaptures.findPendingByAgent(
        input.agentId,
      );
      if (pendingForAgent) {
        if (pendingForAgent.value.alias === service.alias) {
          return pendingForAgent.value;
        }

        throw new ConflictError(
          `Agent '${input.agentId}' already has a pending credential capture '${pendingForAgent.value.id}'.`,
        );
      }

      const storedWorkingContext = storedTask
        ? await options.repositories.workingContexts.getByAgent(input.agentId)
        : null;
      if (storedTask && !storedWorkingContext) {
        throw new NotFoundError(`Working context for agent '${input.agentId}' was not found.`);
      }

      const storedRunJournal = storedTask ? await loadRunJournal(options.repositories, storedTask.value) : null;
      const credentialCaptureId = createRuntimeIdentifier('ccp');
      const waitingProgressSummary = storedTask
        ? buildWaitingProgressSummary({
            displayName: service.displayName,
            reason: input.reason ?? service.reasonTemplate,
            task: storedTask.value,
          })
        : null;
      const updatedTask = storedTask
        ? withTaskProgressSummary(
            {
              ...transitionTaskState(storedTask.value, 'waiting_for_user', requestedAt),
              activeCredentialCaptureId: credentialCaptureId,
            },
            waitingProgressSummary,
            requestedAt,
          )
        : undefined;
      const updatedWorkingContext: WorkingContext | undefined =
        storedWorkingContext && updatedTask
          ? {
              ...storedWorkingContext.value,
              pendingCredentialCaptureIds: appendUnique(
                storedWorkingContext.value.pendingCredentialCaptureIds,
                credentialCaptureId,
              ),
              updatedAt: requestedAt,
            }
          : undefined;
      const updatedRunJournal: RunJournal | undefined =
        storedRunJournal && waitingProgressSummary
          ? {
              ...storedRunJournal.value,
              updatedAt: requestedAt,
              lastEntryAt: requestedAt,
              progressSummary: waitingProgressSummary,
              summary: waitingProgressSummary.headline,
            }
          : undefined;
      const credentialCapture: CredentialCapture = {
        id: credentialCaptureId,
        recordType: 'credential_capture',
        schemaVersion: 1,
        createdAt: requestedAt,
        updatedAt: requestedAt,
        correlation: {
          ...input.correlation,
          ...(input.taskId ? { taskId: input.taskId } : {}),
        },
        agentId: input.agentId,
        taskId: input.taskId ?? null,
        runJournalId: updatedRunJournal?.id ?? storedTask?.value.currentRunJournalId ?? null,
        state: 'requested',
        provider: service.provider,
        alias: service.alias,
        displayName: service.displayName,
        reason: input.reason ?? service.reasonTemplate,
        storageNotice: service.storageNotice,
        requestChannelId: input.channelId,
        requestMessageId: null,
        receivedInboundMessageId: null,
        credentialId: null,
        replacingCredentialId:
          (await options.repositories.credentials.findByAlias(
            input.agentId,
            service.provider,
            service.alias,
          ))?.value.id ?? null,
        requestedAt,
        receivedAt: null,
        completedAt: null,
        expiresAt: null,
      };
      const runJournalEntry: RunJournalEntry | undefined = updatedRunJournal
        ? {
            id: createRuntimeIdentifier('rje'),
            recordType: 'run_journal_entry',
            schemaVersion: 1,
            createdAt: requestedAt,
            updatedAt: requestedAt,
            correlation: {
              ...input.correlation,
              ...(input.taskId ? { taskId: input.taskId } : {}),
            },
            journalId: updatedRunJournal.id,
            agentId: input.agentId,
            entryKind: 'waiting' as const,
            level: 'info' as const,
            recordedAt: requestedAt,
            message: `Waiting for credential input: ${service.displayName}`,
            taskStateAfter: updatedTask?.state ?? null,
            progressSummaryPatch: waitingProgressSummary,
            artifactIds: [],
            approvalId: null,
          }
        : undefined;

      const mutation = await options.repositories.credentialCaptures.createBlockingRequest({
        credentialCapture,
        ...(updatedRunJournal ? { runJournal: updatedRunJournal } : {}),
        ...(storedRunJournal?.etag ? { runJournalEtag: storedRunJournal.etag } : {}),
        ...(runJournalEntry ? { runJournalEntry } : {}),
        ...(updatedTask && storedTask
          ? {
              task: updatedTask,
              taskEtag: storedTask.etag,
            }
          : {}),
        ...(updatedWorkingContext && storedWorkingContext
          ? {
              workingContext: updatedWorkingContext,
              workingContextEtag: storedWorkingContext.etag,
            }
          : {}),
      });

      if (storedTask?.value.currentHandsRunId) {
        try {
          await options.handsRuntimeService.releaseForUser({
            handsRunId: storedTask.value.currentHandsRunId,
            releasedAt: requestedAt,
            credentialCaptureId,
            correlation: {
              ...input.correlation,
              ...(input.taskId ? { taskId: input.taskId } : {}),
            },
          });
        } catch (error) {
          options.logger.warn('credential_lifecycle.release_for_user_failed', {
            credentialCaptureId,
            handsRunId: storedTask.value.currentHandsRunId,
            message: error instanceof Error ? error.message : 'Unknown release failure.',
          });
        }
      }

      const promptMessage = await options.outboundMessagingService.sendMessage({
        actions: [],
        agentId: input.agentId,
        channelId: input.channelId,
        correlation: {
          ...input.correlation,
          idempotencyKey: `${input.correlation.idempotencyKey}-credential-${credentialCaptureId}`,
          ...(input.taskId ? { taskId: input.taskId } : {}),
        },
        text: buildCapturePrompt({
          displayName: service.displayName,
          reason: credentialCapture.reason,
          storageNotice: service.storageNotice,
        }),
      });

      return (
        await options.repositories.credentialCaptures.replace(
          {
            ...mutation.credentialCapture.value,
            requestMessageId: promptMessage.id,
            updatedAt: promptMessage.updatedAt,
          },
          mutation.credentialCapture.etag,
        )
      ).value;
    },

    async completePendingCaptureFromTrustedInput(input): Promise<{ handled: boolean }> {
      const pendingCapture = await options.repositories.credentialCaptures.findPendingByAgent(
        input.agentId,
      );
      if (!pendingCapture || pendingCapture.value.requestChannelId !== input.channelId) {
        return { handled: false };
      }

      const completedAt = now();
      const normalizedPlaintext = input.plaintext.trim();
      const storedTask =
        pendingCapture.value.taskId != null
          ? await options.repositories.tasks.getTask(input.agentId, pendingCapture.value.taskId)
          : null;
      const storedWorkingContext =
        storedTask != null
          ? await options.repositories.workingContexts.getByAgent(input.agentId)
          : null;
      if (storedTask && !storedWorkingContext) {
        throw new NotFoundError(`Working context for agent '${input.agentId}' was not found.`);
      }

      const storedRunJournal = storedTask ? await loadRunJournal(options.repositories, storedTask.value) : null;

      if (normalizedPlaintext.toLowerCase() === 'cancel') {
        const cancelledCapture: CredentialCapture = {
          ...pendingCapture.value,
          state: 'cancelled',
          receivedInboundMessageId: input.inboundMessageId,
          receivedAt: completedAt,
          completedAt,
          updatedAt: completedAt,
        };
        const cancelledTask =
          storedTask != null
            ? withTaskProgressSummary(
                {
                  ...transitionTaskState(storedTask.value, 'cancelled', completedAt),
                  activeCredentialCaptureId: null,
                  cancellationReason: 'Credential capture was cancelled by the user.',
                },
                {
                  headline: `Cancelled: ${storedTask.value.requestedOutcome}`,
                  detail: 'Credential capture was cancelled by the user.',
                  waitingForUser: false,
                  lastActor: 'system',
                },
                completedAt,
              )
            : undefined;
        const cancelledWorkingContext: WorkingContext | undefined =
          storedWorkingContext && cancelledTask
            ? {
                ...storedWorkingContext.value,
                pendingCredentialCaptureIds: removeValue(
                  storedWorkingContext.value.pendingCredentialCaptureIds,
                  pendingCapture.value.id,
                ),
                updatedAt: completedAt,
              }
            : undefined;
        const cancelledRunJournal: RunJournal | undefined =
          storedRunJournal && cancelledTask
            ? {
                ...storedRunJournal.value,
                closedAt: completedAt,
                lastEntryAt: completedAt,
                progressSummary: cancelledTask.progressSummary,
                resultCode: 'credential_capture_cancelled',
                status: 'failed',
                summary: 'Credential capture cancelled by the user.',
                updatedAt: completedAt,
              }
            : undefined;
        const cancelledEntry: RunJournalEntry | undefined = cancelledRunJournal
          ? {
              id: createRuntimeIdentifier('rje'),
              recordType: 'run_journal_entry',
              schemaVersion: 1,
              createdAt: completedAt,
              updatedAt: completedAt,
              correlation: {
                ...input.correlation,
                ...(storedTask ? { taskId: storedTask.value.id } : {}),
              },
              journalId: cancelledRunJournal.id,
              agentId: input.agentId,
              entryKind: 'failure' as const,
              level: 'warn' as const,
              recordedAt: completedAt,
              message: 'Credential capture cancelled by the user.',
              taskStateAfter: cancelledTask?.state ?? null,
              progressSummaryPatch: cancelledTask?.progressSummary ?? null,
              artifactIds: [],
              approvalId: null,
            }
          : undefined;

        await options.repositories.credentialCaptures.finalizeCapture({
          credentialCapture: cancelledCapture,
          credentialCaptureEtag: pendingCapture.etag,
          ...(cancelledRunJournal ? { runJournal: cancelledRunJournal } : {}),
          ...(storedRunJournal?.etag ? { runJournalEtag: storedRunJournal.etag } : {}),
          ...(cancelledEntry ? { runJournalEntry: cancelledEntry } : {}),
          ...(cancelledTask && storedTask
            ? {
                task: cancelledTask,
                taskEtag: storedTask.etag,
              }
            : {}),
          ...(cancelledWorkingContext && storedWorkingContext
            ? {
                workingContext: cancelledWorkingContext,
                workingContextEtag: storedWorkingContext.etag,
              }
            : {}),
        });
        await options.outboundMessagingService.sendMessage({
          actions: [],
          agentId: input.agentId,
          channelId: input.channelId,
          correlation: {
            ...input.correlation,
            idempotencyKey: `${input.correlation.idempotencyKey}-credential-cancel-${pendingCapture.value.id}`,
            ...(storedTask ? { taskId: storedTask.value.id } : {}),
          },
          text: buildCancellationMessage(pendingCapture.value.displayName),
        });

        return { handled: true };
      }

      const storedCredentialRef = await upsertCredentialFromPlaintext({
        agentId: input.agentId,
        alias: pendingCapture.value.alias,
        channelId: input.channelId,
        correlation: {
          ...input.correlation,
          ...(pendingCapture.value.taskId ? { taskId: pendingCapture.value.taskId } : {}),
        },
        displayName: pendingCapture.value.displayName,
        plaintext: normalizedPlaintext,
      });

      const updatedCapture: CredentialCapture = {
        ...pendingCapture.value,
        state: 'completed',
        receivedInboundMessageId: input.inboundMessageId,
        credentialId: storedCredentialRef.id,
        receivedAt: completedAt,
        completedAt,
        updatedAt: completedAt,
      };
      const updatedTask =
        storedTask != null
          ? resetTaskLaunchState(
              withTaskProgressSummary(
                {
                  ...transitionTaskState(storedTask.value, 'queued', completedAt),
                  activeCredentialCaptureId: null,
                  cancellationRequestedAt: null,
                  cancellationReason: null,
                },
                createQueuedTaskProgressSummary({
                  detail: 'Credential received. Work will resume automatically.',
                  lastActor: 'system',
                  requestedOutcome: storedTask.value.requestedOutcome,
                }),
                completedAt,
              ),
              completedAt,
            )
          : undefined;
      const updatedWorkingContext: WorkingContext | undefined =
        storedWorkingContext && updatedTask
          ? {
              ...storedWorkingContext.value,
              pendingCredentialCaptureIds: removeValue(
                storedWorkingContext.value.pendingCredentialCaptureIds,
                pendingCapture.value.id,
              ),
              updatedAt: completedAt,
            }
          : undefined;
      const updatedRunJournal: RunJournal | undefined =
        storedRunJournal && updatedTask
          ? {
              ...storedRunJournal.value,
              updatedAt: completedAt,
              lastEntryAt: completedAt,
              progressSummary: updatedTask.progressSummary,
              summary: updatedTask.progressSummary?.headline ?? storedRunJournal.value.summary,
            }
          : undefined;
      const completionEntry: RunJournalEntry | undefined = updatedRunJournal
        ? {
            id: createRuntimeIdentifier('rje'),
            recordType: 'run_journal_entry',
            schemaVersion: 1,
            createdAt: completedAt,
            updatedAt: completedAt,
            correlation: {
              ...input.correlation,
              ...(storedTask ? { taskId: storedTask.value.id } : {}),
            },
            journalId: updatedRunJournal.id,
            agentId: input.agentId,
            entryKind: 'action' as const,
            level: 'info' as const,
            recordedAt: completedAt,
            message: `Credential received: ${pendingCapture.value.displayName}`,
            taskStateAfter: updatedTask?.state ?? null,
            progressSummaryPatch: updatedTask?.progressSummary ?? null,
            artifactIds: [],
            approvalId: null,
          }
        : undefined;

      await options.repositories.credentialCaptures.finalizeCapture({
        credentialCapture: updatedCapture,
        credentialCaptureEtag: pendingCapture.etag,
        ...(updatedRunJournal ? { runJournal: updatedRunJournal } : {}),
        ...(storedRunJournal?.etag ? { runJournalEtag: storedRunJournal.etag } : {}),
        ...(completionEntry ? { runJournalEntry: completionEntry } : {}),
        ...(updatedTask && storedTask
          ? {
              task: updatedTask,
              taskEtag: storedTask.etag,
            }
          : {}),
        ...(updatedWorkingContext && storedWorkingContext
          ? {
              workingContext: updatedWorkingContext,
              workingContextEtag: storedWorkingContext.etag,
            }
          : {}),
      });

      if (updatedTask) {
        try {
          await options.taskQueueService.requestQueuedTaskStart({
            agentId: updatedTask.agentId,
            correlation: {
              ...input.correlation,
              taskId: updatedTask.id,
            },
            taskId: updatedTask.id,
          });
        } catch (error) {
          options.logger.warn('credential_lifecycle.restart_failed', {
            credentialCaptureId: updatedCapture.id,
            taskId: updatedTask.id,
            message: error instanceof Error ? error.message : 'Unknown restart failure.',
          });
        }
      }

      await options.outboundMessagingService.sendMessage({
        actions: [],
        agentId: input.agentId,
        channelId: input.channelId,
        correlation: {
          ...input.correlation,
          idempotencyKey: `${input.correlation.idempotencyKey}-credential-complete-${pendingCapture.value.id}`,
          ...(updatedTask ? { taskId: updatedTask.id } : {}),
        },
        text: buildCompletionMessage(pendingCapture.value.displayName),
      });

      return { handled: true };
    },

    async resolveSandboxBindings(input) {
      const bindings = [];

      for (const alias of input.credentialAliases) {
        const service = resolveCredentialService(options.repositoryConfig, alias);
        const credential = await options.repositories.credentials.findByAlias(
          input.agentId,
          service.provider,
          service.alias,
        );
        if (!credential || credential.value.status !== 'active') {
          throw new NotFoundError(
            `Active credential '${service.alias}' was not found for agent '${input.agentId}'.`,
          );
        }

        bindings.push(...createSandboxCredentialBindings({
          credential: credential.value,
          service,
        }));
      }

      return bindings;
    },

    async upsertAgentCredentialFromPlaintext(input) {
      return upsertCredentialFromPlaintext(input);
    },

    async revokeCredential(input) {
      const storedCredential = await options.repositories.credentials.get(
        input.agentId,
        input.credentialId,
      );
      if (!storedCredential) {
        throw new NotFoundError(
          `Credential '${input.credentialId}' was not found for agent '${input.agentId}'.`,
        );
      }

      if (storedCredential.value.status === 'revoked') {
        return toAdminCredentialSummary(storedCredential.value);
      }

      const revokedAt = now();
      const revokedCredential = await options.repositories.credentials.revokeCredential({
        credentialRef: {
          ...storedCredential.value,
          revokedAt,
          status: 'revoked',
          updatedAt: revokedAt,
        },
        expectedCredentialRefEtag: storedCredential.etag,
      });

      const referencingChannels = await options.repositories.channels.listByAgent(input.agentId);
      for (const storedChannel of referencingChannels) {
        if (storedChannel.value.credentialId !== input.credentialId) {
          continue;
        }

        await options.repositories.channels.replace(
          {
            ...storedChannel.value,
            credentialId: undefined,
            updatedAt: revokedAt,
          },
          storedChannel.etag,
        );
      }

      options.logger.info('credential_lifecycle.revoked', {
        agentId: input.agentId,
        credentialId: input.credentialId,
      });

      return toAdminCredentialSummary(revokedCredential.value);
    },
  };
}

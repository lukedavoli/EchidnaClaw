import { randomBytes } from 'node:crypto';

import type {
  Approval,
  ApprovalCategory,
  ApprovalDecisionChannelActionResponse,
  HeadTurn,
  RepositoryConfig,
  RunJournal,
  RunJournalEntry,
  Task,
  WorkingContext,
} from '@echidna-claw/contracts';
import {
  createQueuedTaskProgressSummary,
  createApprovalActionFingerprint,
  isApprovalExpired,
  resetTaskLaunchState,
  resolveApprovalPolicy,
  transitionApprovalState,
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

function createRuntimeIdentifier(prefix: 'apr' | 'rje'): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

function appendUnique<TValue>(values: readonly TValue[], nextValue: TValue): TValue[] {
  return values.includes(nextValue) ? [...values] : [...values, nextValue];
}

function removeValue<TValue>(values: readonly TValue[], target: TValue): TValue[] {
  return values.filter((value) => value !== target);
}

function buildWaitingProgressSummary(input: {
  category: ApprovalCategory;
  summary: string;
  task: Task;
}): Task['progressSummary'] {
  return {
    headline: `Waiting for approval: ${input.summary}`,
    detail: `Approval category: ${input.category}.`,
    waitingForUser: true,
    lastActor: input.task.state === 'running' ? 'hands' : 'head',
  };
}

function buildDecisionReason(nextState: Approval['state']): string {
  switch (nextState) {
    case 'approved':
      return 'Approved from the trusted Telegram channel.';
    case 'rejected':
      return 'Rejected from the trusted Telegram channel.';
    case 'expired':
      return 'The approval expired before a decision was accepted.';
    default:
      return 'The approval was cancelled by the system.';
  }
}

function buildApprovalPrompt(input: {
  expiresAt: string | null;
  stepUpRequired: boolean;
  summary: string;
}): string {
  const lines = [`Approval needed: ${input.summary}`];

  if (input.stepUpRequired) {
    lines.push('This is a higher-risk action and requires explicit confirmation.');
  }

  if (input.expiresAt) {
    lines.push(`This request expires at ${input.expiresAt}.`);
  }

  return lines.join('\n');
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

export interface ApprovalLifecycleService {
  recordDecision(input: ApprovalDecisionChannelActionResponse): Promise<Approval>;
  requestApproval(input: {
    actionFingerprint?: string;
    agentId: string;
    blocking?: boolean;
    category: ApprovalCategory;
    channelId: string;
    correlation: HeadTurn['correlation'];
    expiresAt?: string | null;
    summary: string;
    taskId: string;
  }): Promise<Approval>;
}

export function createApprovalLifecycleService(options: {
  handsRuntimeService: HandsService;
  logger: Logger;
  outboundMessagingService: OutboundMessagingService;
  repositories: RepositoryBundle;
  repositoryConfig: RepositoryConfig;
  taskQueueService: TaskQueueService;
}): ApprovalLifecycleService {
  return {
    async requestApproval(input) {
      const requestedAt = now();
      const blocking = input.blocking ?? true;
      const policy = resolveApprovalPolicy(options.repositoryConfig, input.category);
      const storedTask = await options.repositories.tasks.getTask(input.agentId, input.taskId);
      if (!storedTask) {
        throw new NotFoundError(`Task '${input.taskId}' was not found.`);
      }

      if (storedTask.value.activeApprovalId) {
        const activeApproval = await options.repositories.approvals.get(
          input.agentId,
          storedTask.value.activeApprovalId,
        );
        if (
          activeApproval &&
          activeApproval.value.state === 'requested' &&
          activeApproval.value.actionFingerprint ===
            (input.actionFingerprint ??
              createApprovalActionFingerprint({
                category: input.category,
                summary: input.summary,
                taskEnvelopeId: storedTask.value.activeTaskEnvelopeId,
                taskId: input.taskId,
              }))
        ) {
          return activeApproval.value;
        }

        throw new ConflictError(
          `Task '${input.taskId}' is already blocked by approval '${storedTask.value.activeApprovalId}'.`,
        );
      }

      if (!['queued', 'running'].includes(storedTask.value.state)) {
        throw new ConflictError('Only queued or running tasks can request a blocking approval.');
      }

      const storedWorkingContext = await options.repositories.workingContexts.getByAgent(input.agentId);
      if (!storedWorkingContext) {
        throw new NotFoundError(`Working context for agent '${input.agentId}' was not found.`);
      }

      const storedRunJournal = await loadRunJournal(options.repositories, storedTask.value);
      const approvalId = createRuntimeIdentifier('apr');
      const actionFingerprint =
        input.actionFingerprint ??
        createApprovalActionFingerprint({
          category: input.category,
          summary: input.summary,
          taskEnvelopeId: storedTask.value.activeTaskEnvelopeId,
          taskId: input.taskId,
        });
      const expiresAt =
        input.expiresAt ??
        new Date(
          Date.parse(requestedAt) + policy.defaultExpiryMinutes * 60 * 1000,
        ).toISOString();
      const waitingProgressSummary = buildWaitingProgressSummary({
        category: input.category,
        summary: input.summary,
        task: storedTask.value,
      });
      const waitingTask = withTaskProgressSummary(
        {
          ...transitionTaskState(storedTask.value, 'waiting_for_user', requestedAt),
          activeApprovalId: approvalId,
        },
        waitingProgressSummary,
        requestedAt,
      );
      const updatedWorkingContext: WorkingContext = {
        ...storedWorkingContext.value,
        pendingApprovalIds: appendUnique(storedWorkingContext.value.pendingApprovalIds, approvalId),
        updatedAt: requestedAt,
      };
      const updatedRunJournal: RunJournal | undefined = storedRunJournal
        ? {
            ...storedRunJournal.value,
            updatedAt: requestedAt,
            lastEntryAt: requestedAt,
            progressSummary: waitingProgressSummary,
            summary: waitingProgressSummary?.headline ?? storedRunJournal.value.summary,
          }
        : undefined;
      const approval: Approval = {
        id: approvalId,
        recordType: 'approval',
        schemaVersion: 1,
        createdAt: requestedAt,
        updatedAt: requestedAt,
        correlation: {
          ...input.correlation,
          taskId: input.taskId,
        },
        agentId: input.agentId,
        taskId: input.taskId,
        state: 'requested',
        requestedAt,
        decidedAt: null,
        blocking,
        category: input.category,
        summary: input.summary,
        actionFingerprint,
        requestChannelId: input.channelId,
        requestMessageId: null,
        taskEnvelopeId: storedTask.value.activeTaskEnvelopeId,
        runJournalId: updatedRunJournal?.id ?? storedTask.value.currentRunJournalId ?? null,
        decisionInboundMessageId: null,
        decisionChannelId: null,
        decisionSource: null,
        stepUpRequired: policy.stepUpRequired,
        decisionReason: '',
        expiresAt,
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
              taskId: input.taskId,
            },
            journalId: updatedRunJournal.id,
            agentId: input.agentId,
            entryKind: 'waiting' as const,
            level: 'info' as const,
            recordedAt: requestedAt,
            message: `Waiting for user approval: ${input.summary}`,
            taskStateAfter: waitingTask.state,
            progressSummaryPatch: waitingProgressSummary,
            artifactIds: [],
            approvalId,
          }
        : undefined;

      const mutation = await options.repositories.approvals.createBlockingRequest({
        approval,
        ...(updatedRunJournal ? { runJournal: updatedRunJournal } : {}),
        ...(storedRunJournal?.etag ? { runJournalEtag: storedRunJournal.etag } : {}),
        ...(runJournalEntry ? { runJournalEntry } : {}),
        task: waitingTask,
        taskEtag: storedTask.etag,
        workingContext: updatedWorkingContext,
        workingContextEtag: storedWorkingContext.etag,
      });

      if (storedTask.value.currentHandsRunId) {
        try {
          await options.handsRuntimeService.releaseForUser({
            handsRunId: storedTask.value.currentHandsRunId,
            releasedAt: requestedAt,
            approvalId: approvalId,
            correlation: {
              ...input.correlation,
              taskId: input.taskId,
            },
          });
        } catch (error) {
          options.logger.warn('approval_lifecycle.release_for_user_failed', {
            approvalId,
            handsRunId: storedTask.value.currentHandsRunId,
            message: error instanceof Error ? error.message : 'Unknown release failure.',
          });
        }
      }

      const promptMessage = await options.outboundMessagingService.sendMessage({
        actions: [
          {
            approvalId,
            decision: 'approve',
            kind: 'approval_decision',
            label: 'Approve',
          },
          {
            approvalId,
            decision: 'reject',
            kind: 'approval_decision',
            label: 'Reject',
          },
        ],
        agentId: input.agentId,
        channelId: input.channelId,
        correlation: {
          ...input.correlation,
          idempotencyKey: `${input.correlation.idempotencyKey}-approval-${approvalId}`,
          taskId: input.taskId,
        },
        text: buildApprovalPrompt({
          expiresAt,
          stepUpRequired: policy.stepUpRequired,
          summary: input.summary,
        }),
      });

      const updatedApprovalWithMessage: Approval = {
        ...mutation.approval.value,
        requestMessageId: promptMessage.id,
        updatedAt: promptMessage.updatedAt,
      };
      return (
        await options.repositories.approvals.replace(
          updatedApprovalWithMessage,
          mutation.approval.etag,
        )
      ).value;
    },

    async recordDecision(input: ApprovalDecisionChannelActionResponse): Promise<Approval> {
      const decidedAt = now();
      const storedApproval = await options.repositories.approvals.findById(input.approvalId);
      if (!storedApproval) {
        throw new NotFoundError(`Approval '${input.approvalId}' was not found.`);
      }

      if (
        storedApproval.value.requestChannelId != null &&
        storedApproval.value.requestChannelId !== input.channelId
      ) {
        throw new ConflictError('Approval decisions are only accepted from the originating channel.');
      }

      if (storedApproval.value.state !== 'requested') {
        return storedApproval.value;
      }

      const storedTask = await options.repositories.tasks.getTask(
        storedApproval.value.agentId,
        storedApproval.value.taskId,
      );
      if (!storedTask) {
        throw new NotFoundError(`Task '${storedApproval.value.taskId}' was not found.`);
      }

      const storedWorkingContext = await options.repositories.workingContexts.getByAgent(
        storedApproval.value.agentId,
      );
      if (!storedWorkingContext) {
        throw new NotFoundError(
          `Working context for agent '${storedApproval.value.agentId}' was not found.`,
        );
      }

      const storedRunJournal = await loadRunJournal(options.repositories, storedTask.value);
      const nextState: Approval['state'] = isApprovalExpired(storedApproval.value, decidedAt)
        ? 'expired'
        : input.decision === 'approve'
          ? 'approved'
          : 'rejected';
      const decisionReason = buildDecisionReason(nextState);
      const updatedApproval = transitionApprovalState(
        {
          ...storedApproval.value,
          decisionInboundMessageId: input.inboundMessageId,
          decisionChannelId: input.channelId,
          decisionSource:
            nextState === 'expired' ? 'expired' : 'telegram_callback',
        },
        nextState,
        decidedAt,
        decisionReason,
      );
      const updatedTaskBase =
        nextState === 'approved'
          ? resetTaskLaunchState(
              withTaskProgressSummary(
                {
                  ...transitionTaskState(storedTask.value, 'queued', decidedAt),
                  activeApprovalId: null,
                  cancellationRequestedAt: null,
                  cancellationReason: null,
                },
                createQueuedTaskProgressSummary({
                  detail: 'Approval received. Work will resume automatically.',
                  lastActor: 'system',
                  requestedOutcome: storedTask.value.requestedOutcome,
                }),
                decidedAt,
              ),
              decidedAt,
            )
          : withTaskProgressSummary(
              {
                ...transitionTaskState(storedTask.value, 'cancelled', decidedAt),
                activeApprovalId: null,
                cancellationReason: decisionReason,
              },
              {
                headline: `Cancelled: ${storedTask.value.requestedOutcome}`,
                detail: decisionReason,
                waitingForUser: false,
                lastActor: 'system',
              },
              decidedAt,
            );
      const updatedWorkingContext: WorkingContext = {
        ...storedWorkingContext.value,
        pendingApprovalIds: removeValue(
          storedWorkingContext.value.pendingApprovalIds,
          storedApproval.value.id,
        ),
        updatedAt: decidedAt,
      };
      const updatedRunJournal: RunJournal | undefined = storedRunJournal
        ? {
            ...storedRunJournal.value,
            updatedAt: decidedAt,
            lastEntryAt: decidedAt,
            ...(nextState === 'approved'
              ? {
                  progressSummary: updatedTaskBase.progressSummary,
                  summary:
                    updatedTaskBase.progressSummary?.headline ?? storedRunJournal.value.summary,
                }
              : {
                  closedAt: decidedAt,
                  progressSummary: updatedTaskBase.progressSummary,
                  resultCode: nextState,
                  status: 'failed' as const,
                  summary: decisionReason,
                }),
          }
        : undefined;
      const runJournalEntry: RunJournalEntry | undefined = updatedRunJournal
        ? {
            id: createRuntimeIdentifier('rje'),
            recordType: 'run_journal_entry',
            schemaVersion: 1,
            createdAt: decidedAt,
            updatedAt: decidedAt,
            correlation: {
              ...input.correlation,
              taskId: storedTask.value.id,
            },
            journalId: updatedRunJournal.id,
            agentId: storedApproval.value.agentId,
            entryKind: nextState === 'approved' ? ('action' as const) : ('failure' as const),
            level: nextState === 'approved' ? ('info' as const) : ('warn' as const),
            recordedAt: decidedAt,
            message: decisionReason,
            taskStateAfter: updatedTaskBase.state,
            progressSummaryPatch: updatedTaskBase.progressSummary,
            artifactIds: [],
            approvalId: storedApproval.value.id,
          }
        : undefined;

      const mutation = await options.repositories.approvals.recordDecision({
        approval: updatedApproval,
        approvalEtag: storedApproval.etag,
        ...(updatedRunJournal ? { runJournal: updatedRunJournal } : {}),
        ...(storedRunJournal?.etag ? { runJournalEtag: storedRunJournal.etag } : {}),
        ...(runJournalEntry ? { runJournalEntry } : {}),
        task: updatedTaskBase,
        taskEtag: storedTask.etag,
        workingContext: updatedWorkingContext,
        workingContextEtag: storedWorkingContext.etag,
      });

      if (nextState === 'approved') {
        try {
          await options.taskQueueService.requestQueuedTaskStart({
            agentId: mutation.task.value.agentId,
            correlation: {
              ...input.correlation,
              taskId: mutation.task.value.id,
            },
            taskId: mutation.task.value.id,
          });
        } catch (error) {
          options.logger.warn('approval_lifecycle.restart_failed', {
            approvalId: mutation.approval.value.id,
            taskId: mutation.task.value.id,
            message: error instanceof Error ? error.message : 'Unknown restart failure.',
          });
        }
      }

      return mutation.approval.value;
    },
  };
}

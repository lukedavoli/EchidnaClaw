import { randomBytes } from 'node:crypto';

import type {
  Agent,
  Channel,
  HeadEffectSummary,
  HeadReplyDraft,
  HeadService,
  HeadStartTurnRequest,
  HeadSupersedeTurnRequest,
  HeadTurn,
  HeadTurnExecutionResult,
  InboundMessage,
  RepositoryConfig,
  Schedule,
  Task,
  WorkingContext,
} from '@echidna-claw/contracts';
import { headTurnExecutionResultSchema } from '@echidna-claw/contracts';
import {
  applyEpisodeRotation,
  applyHeadTurnClaim,
  applyHeadTurnCommitted,
  applyHeadTurnSuperseded,
  clearHeadTurnClaim,
  isAgentOperational,
  shouldRotateEpisode,
  shouldSupersedeTurn,
  transitionTaskState,
  withTaskProgressSummary,
} from '@echidna-claw/domain';
import type { Logger } from '@echidna-claw/observability';
import {
  type DueTaskPromptContext,
  HEAD_BASE_PROMPT_PROFILE_VERSION,
  buildCapabilitySummary,
  buildHeadPrompt,
} from '@echidna-claw/prompting';
import {
  DuplicateRecordError,
  OptimisticConcurrencyError,
  type StoredRecord,
} from '@echidna-claw/persistence';

import type { DeferredHeadDirective, HeadRuntimeAdapter } from '../../adapters/foundry/index.js';
import type { ApiRuntimeConfig } from '../../config/api-runtime-config.js';
import type { RepositoryBundle } from '../../adapters/repositories/index.js';
import { ConflictError, NotFoundError } from '../../http/errors.js';
import { createHeadToolCatalog } from './head-tool-catalog.js';
import type { ScheduleMutationService } from './schedule-mutation-service.js';
import type { TaskQueueService } from './task-queue-service.js';
import type { ApprovalLifecycleService } from './approval-lifecycle-service.js';
import type { AuditHistoryService } from './audit-history-service.js';
import type { ConversationMemoryService } from './conversation-memory-service.js';
import type { CredentialLifecycleService } from './credential-lifecycle-service.js';
import type { UsageAccountingService } from './usage-accounting-service.js';
import type {
  WorkingContextSummaryService,
  WorkingContextSummarySnapshot,
} from './working-context-summary-service.js';

const HEAD_TURN_CLAIM_RETRY_LIMIT = 3;

type TriggerLoadResult = {
  dueTaskContext?: DueTaskPromptContext | undefined;
  inReplyToInboundMessageId?: string;
  latestTrustedMessageText: string | null;
  messages: InboundMessage[];
  modelInput: Array<{
    role: 'developer' | 'system' | 'user';
    text: string;
  }>;
};

type TurnRejection = {
  code: string;
  message: string;
};

function now(): string {
  return new Date().toISOString();
}

function createRuntimeIdentifier(prefix: 'ctx' | 'hdr'): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

function createEmptyEffectSummary(): HeadEffectSummary {
  return {
    taskRequested: false,
    scheduleChangeRequested: false,
    approvalRequested: false,
    credentialRequested: false,
    sandboxRequested: false,
    memoryOperationRequested: false,
  };
}

function collectDeferredMemoryWrites(
  directives: readonly DeferredHeadDirective[],
): Array<{
  category:
    | 'preference'
    | 'standing_instruction'
    | 'durable_fact'
    | 'recurring_pattern'
    | 'agent_guidance';
  text: string;
}> {
  return directives
    .filter((directive): directive is Extract<DeferredHeadDirective, { kind: 'memory_write' }> =>
      directive.kind === 'memory_write',
    )
    .map((directive) => directive.candidate);
}

function createWorkingContextRecord(input: {
  agentId: string;
  correlation: HeadStartTurnRequest['correlation'];
  createdAt: string;
}): WorkingContext {
  return {
    id: createRuntimeIdentifier('ctx'),
    recordType: 'working_context',
    schemaVersion: 1,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    correlation: input.correlation,
    agentId: input.agentId,
    latestInboundSequence: 0,
    latestProcessedSequence: 0,
    activeHeadTurnId: null,
    activeHeadTurnStartedAt: null,
    activeHeadTurnReadThroughSequence: null,
    pendingSupersededBySequence: null,
    debounceUntil: null,
    pendingDebounceSequence: null,
    episodeLocalDate: null,
    episodeTurnCount: 0,
    activeTaskId: null,
    summary: '',
    summaryUpdatedAt: null,
    currentObjective: null,
    latestHandsStatus: null,
    openQuestions: [],
    conversationCursor: undefined,
    openTaskIds: [],
    pendingApprovalIds: [],
    pendingCredentialCaptureIds: [],
  };
}

function createRunningHeadTurn(input: {
  agentId: string;
  correlation: HeadStartTurnRequest['correlation'];
  createdAt: string;
  episodeLocalDate: string | null;
  episodeTurnIndex: number | null;
  headTurnId: string;
  trigger: HeadStartTurnRequest['trigger'];
  workingContext: WorkingContext;
}): HeadTurn {
  return {
    id: input.headTurnId,
    recordType: 'head_turn',
    schemaVersion: 1,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    correlation: {
      ...input.correlation,
      headTurnId: input.headTurnId,
    },
    agentId: input.agentId,
    workingContextId: input.workingContext.id,
    state: 'running',
    triggerKind: input.trigger.kind,
    inboundMessageIds:
      input.trigger.kind === 'trusted_messages' ? input.trigger.inboundMessageIds : [],
    readThroughMessageSequence:
      input.trigger.kind === 'trusted_messages'
        ? input.trigger.readThroughMessageSequence
        : null,
    taskId: input.trigger.kind === 'due_task' ? input.trigger.taskId ?? null : null,
    scheduleId:
      input.trigger.kind === 'due_task' ? input.trigger.scheduleId ?? null : null,
    dueAt: input.trigger.kind === 'due_task' ? input.trigger.dueAt : null,
    claimedAt: input.createdAt,
    startedAt: input.createdAt,
    completedAt: null,
    staleCheckedAt: null,
    episodeLocalDate: input.episodeLocalDate,
    episodeTurnIndex: input.episodeTurnIndex,
    supersededBySequence: null,
    providerConversationId: input.workingContext.conversationCursor ?? null,
    providerRunId: null,
    memorySearchId: null,
    memoryUpdateIds: [],
    promptProfileVersion: HEAD_BASE_PROMPT_PROFILE_VERSION,
    completionKind: null,
    failureCode: undefined,
    failureMessage: undefined,
    responseMessageId: null,
  };
}

function createRejectedHeadTurn(input: {
  agentId: string;
  correlation: HeadStartTurnRequest['correlation'];
  rejectedAt: string;
  rejection: TurnRejection;
  trigger: HeadStartTurnRequest['trigger'];
  workingContext: WorkingContext;
}): HeadTurn {
  const headTurnId = createRuntimeIdentifier('hdr');

  return {
    id: headTurnId,
    recordType: 'head_turn',
    schemaVersion: 1,
    createdAt: input.rejectedAt,
    updatedAt: input.rejectedAt,
    correlation: {
      ...input.correlation,
      headTurnId,
    },
    agentId: input.agentId,
    workingContextId: input.workingContext.id,
    state: 'completed',
    triggerKind: input.trigger.kind,
    inboundMessageIds:
      input.trigger.kind === 'trusted_messages' ? input.trigger.inboundMessageIds : [],
    readThroughMessageSequence:
      input.trigger.kind === 'trusted_messages'
        ? input.trigger.readThroughMessageSequence
        : null,
    taskId: input.trigger.kind === 'due_task' ? input.trigger.taskId ?? null : null,
    scheduleId:
      input.trigger.kind === 'due_task' ? input.trigger.scheduleId ?? null : null,
    dueAt: input.trigger.kind === 'due_task' ? input.trigger.dueAt : null,
    claimedAt: input.rejectedAt,
    startedAt: null,
    completedAt: input.rejectedAt,
    staleCheckedAt: null,
    episodeLocalDate: input.workingContext.episodeLocalDate,
    episodeTurnIndex: null,
    supersededBySequence: null,
    providerConversationId: input.workingContext.conversationCursor ?? null,
    providerRunId: null,
    memorySearchId: null,
    memoryUpdateIds: [],
    promptProfileVersion: HEAD_BASE_PROMPT_PROFILE_VERSION,
    completionKind: 'rejected',
    failureCode: input.rejection.code,
    failureMessage: input.rejection.message,
    responseMessageId: null,
  };
}

function mapCompletionKindToStatus(
  completionKind: HeadTurn['completionKind'],
): HeadTurnExecutionResult['status'] {
  switch (completionKind) {
    case 'reply':
      return 'replied';
    case 'tool_only':
      return 'tool_only';
    case 'rejected':
      return 'rejected';
    case 'failed':
      return 'failed';
    case 'no_op':
    default:
      return 'no_reply';
  }
}

function formatRecurrenceSummary(schedule: Schedule): string {
  const recurrence = schedule.recurrence;

  if (recurrence.frequency === 'hourly') {
    return `every ${recurrence.interval} hour(s) in ${recurrence.timeZone}`;
  }

  if (recurrence.frequency === 'daily') {
    return `every ${recurrence.interval} day(s) at ${recurrence.localTime ?? 'unspecified'} in ${recurrence.timeZone}`;
  }

  return `every ${recurrence.interval} week(s) on ${(recurrence.weekdays ?? []).join(', ') || 'anchor weekday'} at ${recurrence.localTime ?? 'unspecified'} in ${recurrence.timeZone}`;
}

function buildDueTaskPromptContext(input: {
  schedule?: Schedule | null;
  task?: Task | null;
}): DueTaskPromptContext | undefined {
  if (!input.task && !input.schedule) {
    return undefined;
  }

  return {
    origin: input.schedule ? 'schedule' : 'one_off',
    ...(input.task
      ? {
          task: {
            dueAt: input.task.dueAt,
            notes: input.task.notes,
            progressHeadline: input.task.progressSummary?.headline ?? null,
            queueLabel: `${input.task.queue.lane}/${input.task.queue.priority}`,
            requestedByKind: input.task.requestedBy.kind,
            requestedOutcome: input.task.requestedOutcome,
            scheduleId: input.task.scheduleId ?? null,
            state: input.task.state,
            taskId: input.task.id,
            taskType: input.task.type,
          },
        }
      : {}),
    ...(input.schedule
      ? {
          schedule: {
            description: input.schedule.description,
            lastMaterializedOccurrenceAt: input.schedule.lastMaterializedOccurrenceAt,
            naturalLanguageRequest: input.schedule.naturalLanguageRequest,
            nextDueAt: input.schedule.nextDueAt,
            recurrenceSummary: formatRecurrenceSummary(input.schedule),
            scheduleId: input.schedule.id,
          },
        }
      : {}),
  };
}

function buildCompletedDueTaskWorkingContext(input: {
  completedAt: string;
  taskId: string;
  workingContext: WorkingContext;
}): WorkingContext {
  return {
    ...input.workingContext,
    activeTaskId:
      input.workingContext.activeTaskId === input.taskId ? null : input.workingContext.activeTaskId,
    openTaskIds: input.workingContext.openTaskIds.filter((taskId) => taskId !== input.taskId),
    updatedAt: input.completedAt,
  };
}

function createReplyDraft(input: {
  assistantText: string | null;
  channel: Channel;
  inReplyToInboundMessageId?: string | undefined;
  agentId: string;
}): HeadReplyDraft | null {
  if (!input.assistantText) {
    return null;
  }

  return {
    agentId: input.agentId,
    channelId: input.channel.id,
    inReplyToInboundMessageId: input.inReplyToInboundMessageId,
    body: {
      text: input.assistantText,
      artifacts: [],
    },
  };
}

function resolveHeadRuntimeModel(input: {
  agent: Agent;
  runtimeMode: ApiRuntimeConfig['runtimeMode'];
}): string | undefined {
  if (input.runtimeMode === 'local-minimal') {
    return input.agent.headModel;
  }

  return input.agent.headModel.startsWith('dep-') ||
    input.agent.headModel.startsWith('dep_')
    ? input.agent.headModel
    : undefined;
}

function buildExistingSummarySnapshot(
  workingContext: WorkingContext,
  completedAt: string,
): WorkingContextSummarySnapshot {
  return {
    currentObjective: workingContext.currentObjective,
    latestHandsStatus: workingContext.latestHandsStatus,
    openQuestions: workingContext.openQuestions,
    summary: workingContext.summary,
    summaryUpdatedAt: workingContext.summaryUpdatedAt ?? completedAt,
    usage: null,
  };
}

async function appendHeadTurnAudit(input: {
  action: string;
  agentId: string;
  auditHistoryService: AuditHistoryService;
  correlation: HeadTurn['correlation'];
  occurredAt: string;
  outcome: 'attempted' | 'succeeded' | 'failed' | 'cancelled' | 'denied' | 'expired';
  summary: string;
  turn: HeadTurn;
}): Promise<void> {
  await input.auditHistoryService.append({
    action: input.action,
    agentId: input.agentId,
    attributes: {
      completionKind: input.turn.completionKind,
      dueAt: input.turn.dueAt,
      headTurnId: input.turn.id,
      providerConversationId: input.turn.providerConversationId,
      providerRunId: input.turn.providerRunId,
      state: input.turn.state,
      taskId: input.turn.taskId,
      triggerKind: input.turn.triggerKind,
    },
    category: 'run_outcome',
    correlation: {
      ...input.correlation,
      headTurnId: input.turn.id,
      taskId: input.turn.taskId ?? undefined,
    },
    occurredAt: input.occurredAt,
    outcome: input.outcome,
    summary: input.summary,
  });
}

async function appendHeadTurnAuditSafe(input: {
  action: string;
  agentId: string;
  auditHistoryService?: AuditHistoryService;
  correlation: HeadTurn['correlation'];
  logger: Logger;
  occurredAt: string;
  outcome: 'attempted' | 'succeeded' | 'failed' | 'cancelled' | 'denied' | 'expired';
  summary: string;
  turn: HeadTurn;
}): Promise<void> {
  if (!input.auditHistoryService) {
    input.logger.warn('head_runtime.audit_history_unavailable', {
      action: input.action,
      agentId: input.agentId,
      headTurnId: input.turn.id,
    });
    return;
  }

  try {
    await appendHeadTurnAudit({
      action: input.action,
      agentId: input.agentId,
      auditHistoryService: input.auditHistoryService,
      correlation: input.correlation,
      occurredAt: input.occurredAt,
      outcome: input.outcome,
      summary: input.summary,
      turn: input.turn,
    });
  } catch (error) {
    input.logger.warn('head_runtime.audit_append_failed', {
      action: input.action,
      agentId: input.agentId,
      headTurnId: input.turn.id,
      message: error instanceof Error ? error.message : 'Unknown audit append failure.',
    });
  }
}

async function appendUsageSafe(input: {
  usageAccountingService?: UsageAccountingService;
  logger: Logger;
  append: () => Promise<unknown>;
  agentId: string;
  operation: string;
  source: 'head';
}): Promise<void> {
  if (!input.usageAccountingService) {
    input.logger.warn('head_runtime.usage_accounting_unavailable', {
      agentId: input.agentId,
      operation: input.operation,
      source: input.source,
    });
    return;
  }

  try {
    await input.append();
  } catch (error) {
    input.logger.warn('head_runtime.usage_append_failed', {
      agentId: input.agentId,
      message: error instanceof Error ? error.message : 'Unknown usage append failure.',
      operation: input.operation,
      source: input.source,
    });
  }
}

async function getRequiredAgent(
  repositories: RepositoryBundle,
  agentId: string,
): Promise<StoredRecord<Agent>> {
  const storedAgent = await repositories.agents.get(agentId);
  if (!storedAgent) {
    throw new NotFoundError('Agent not found.');
  }

  return storedAgent;
}

async function getRequiredPrimaryChannel(
  repositories: RepositoryBundle,
  agent: Agent,
): Promise<StoredRecord<Channel>> {
  const storedChannel = await repositories.channels.get(agent.id, agent.primaryChannelId);
  if (!storedChannel) {
    throw new NotFoundError('Primary channel not found.');
  }

  return storedChannel;
}

async function getOrCreateWorkingContext(options: {
  correlation: HeadStartTurnRequest['correlation'];
  repositories: RepositoryBundle;
  startedAt: string;
  storedAgent: StoredRecord<Agent>;
}): Promise<StoredRecord<WorkingContext>> {
  const byAgent = await options.repositories.workingContexts.getByAgent(options.storedAgent.value.id);
  if (byAgent) {
    return byAgent;
  }

  try {
    return await options.repositories.workingContexts.create(
      createWorkingContextRecord({
        agentId: options.storedAgent.value.id,
        correlation: options.correlation,
        createdAt: options.startedAt,
      }),
    );
  } catch (error) {
    if (!(error instanceof DuplicateRecordError)) {
      throw error;
    }

    const existing = await options.repositories.workingContexts.getByAgent(
      options.storedAgent.value.id,
    );
    if (!existing) {
      throw error;
    }

    return existing;
  }
}

async function loadTriggerState(options: {
  agentId: string;
  channel: Channel;
  repositories: RepositoryBundle;
  trigger: HeadStartTurnRequest['trigger'];
}): Promise<TriggerLoadResult> {
  if (options.trigger.kind === 'trusted_messages') {
    const storedMessages = await Promise.all(
      options.trigger.inboundMessageIds.map((messageId) =>
        options.repositories.messages.getInboundMessage(options.agentId, messageId),
      ),
    );

    if (storedMessages.some((message) => message == null)) {
      throw new NotFoundError('One or more inbound messages were not found.');
    }

    const messages = storedMessages
      .map((message) => message!.value)
      .sort((left, right) => left.sequence - right.sequence);
    const latestMessage = messages.at(-1);

    return {
      inReplyToInboundMessageId: latestMessage?.id,
      latestTrustedMessageText: latestMessage?.body.text ?? null,
      messages,
      modelInput: messages.map((message) => ({
        role: 'user' as const,
        text: message.body.text,
      })),
    };
  }

  if (options.trigger.taskId) {
    const task = await options.repositories.tasks.getTask(options.agentId, options.trigger.taskId);
    if (!task) {
      throw new NotFoundError('Due task not found.');
    }

    const scheduleId = options.trigger.scheduleId ?? task.value.scheduleId;
    const schedule =
      scheduleId != null
        ? await options.repositories.schedules.get(options.agentId, scheduleId)
        : null;

    if (scheduleId != null && !schedule) {
      throw new NotFoundError('Due schedule not found.');
    }

    return {
      latestTrustedMessageText: null,
      messages: [],
      modelInput: [
        {
          role: 'developer',
          text: `Review the due task that became ready at ${options.trigger.dueAt}.`,
        },
      ],
      ...(buildDueTaskPromptContext({
        schedule: schedule?.value ?? null,
        task: task.value,
      })
        ? {
            dueTaskContext: buildDueTaskPromptContext({
              schedule: schedule?.value ?? null,
              task: task.value,
            }),
          }
        : {}),
    };
  }

  if (options.trigger.scheduleId) {
    const schedule = await options.repositories.schedules.get(
      options.agentId,
      options.trigger.scheduleId,
    );
    if (!schedule) {
      throw new NotFoundError('Due schedule not found.');
    }
  }

  return {
    latestTrustedMessageText: null,
    messages: [],
    modelInput: [
      {
        role: 'developer',
        text: `A due-task trigger fired at ${options.trigger.dueAt}. Task id: ${options.trigger.taskId ?? 'none'}. Schedule id: ${options.trigger.scheduleId ?? 'none'}.`,
      },
    ],
    ...(options.trigger.scheduleId != null
      ? {
          dueTaskContext: buildDueTaskPromptContext({
            schedule:
              (
                await options.repositories.schedules.get(options.agentId, options.trigger.scheduleId)
              )?.value ?? null,
          }),
        }
      : {}),
  };
}

function validateTurn(options: {
  agent: Agent;
  channel: Channel;
  messages: InboundMessage[];
  request: HeadStartTurnRequest;
}): TurnRejection | null {
  if (!isAgentOperational(options.agent)) {
    return {
      code: 'agent_not_operational',
      message: 'The agent is not operational and cannot execute Head turns.',
    };
  }

  if (options.request.trigger.kind === 'trusted_messages') {
    if (options.channel.state !== 'active') {
      return {
        code: 'primary_channel_not_active',
        message: 'Trusted message turns require an active primary channel.',
      };
    }

    if (options.request.trigger.channelId !== options.channel.id) {
      return {
        code: 'trigger_channel_mismatch',
        message: 'Trusted message turns must target the agent primary channel.',
      };
    }

    if (options.request.correlation.requestedBy?.kind !== 'telegram') {
      return {
        code: 'untrusted_trigger_actor',
        message: 'Trusted message turns must be requested by the Telegram ingress path.',
      };
    }

    if (options.messages.some((message) => !message.trusted)) {
      return {
        code: 'untrusted_message',
        message: 'All inbound messages for a trusted turn must be marked trusted.',
      };
    }

    if (
      options.messages.some(
        (message) =>
          message.agentId !== options.agent.id || message.channelId !== options.channel.id,
      )
    ) {
      return {
        code: 'message_agent_channel_mismatch',
        message: 'Inbound messages must belong to the target agent primary channel.',
      };
    }

    const latestSequence = options.messages.at(-1)?.sequence ?? 0;
    if (latestSequence !== options.request.trigger.readThroughMessageSequence) {
      return {
        code: 'message_sequence_mismatch',
        message: 'Trusted message turns must read through the latest referenced message sequence.',
      };
    }
  } else if (
    options.request.correlation.requestedBy?.kind !== 'scheduler' &&
    options.request.correlation.requestedBy?.kind !== 'system'
  ) {
    return {
      code: 'invalid_due_task_actor',
      message: 'Due-task turns must be requested by the scheduler or system runtime.',
    };
  }

  return null;
}

async function resolveCurrentWorkingContext(options: {
  correlation: HeadStartTurnRequest['correlation'];
  repositories: RepositoryBundle;
  startedAt: string;
  storedAgent: StoredRecord<Agent>;
}): Promise<StoredRecord<WorkingContext>> {
  return getOrCreateWorkingContext(options);
}

async function loadHeadTurnForAgent(options: {
  agentId: string;
  headTurnId: string;
  repositories: RepositoryBundle;
}): Promise<StoredRecord<HeadTurn>> {
  const storedHeadTurn = await options.repositories.execution.getHeadTurn(
    options.agentId,
    options.headTurnId,
  );
  if (!storedHeadTurn) {
    throw new NotFoundError('Head turn not found.');
  }

  return storedHeadTurn;
}

function isTurnSuperseded(options: {
  headTurn: HeadTurn;
  workingContext: WorkingContext;
}): boolean {
  if (options.workingContext.activeHeadTurnId !== options.headTurn.id) {
    return true;
  }

  if (options.headTurn.readThroughMessageSequence == null) {
    return false;
  }

  if (
    shouldSupersedeTurn({
      activeReadThroughSequence: options.headTurn.readThroughMessageSequence,
      latestInboundSequence: options.workingContext.latestInboundSequence,
    })
  ) {
    return true;
  }

  return (
    options.workingContext.pendingSupersededBySequence != null &&
    options.workingContext.pendingSupersededBySequence >
      options.headTurn.readThroughMessageSequence
  );
}

async function reconcileDueTaskBeforeCommit(options: {
  completedAt: string;
  dueAt: string | null;
  repositories: RepositoryBundle;
  taskId: string | null;
  workingContext: StoredRecord<WorkingContext>;
}): Promise<StoredRecord<WorkingContext>> {
  if (!options.taskId) {
    return options.workingContext;
  }

  const storedTask = await options.repositories.tasks.getTask(
    options.workingContext.value.agentId,
    options.taskId,
  );
  if (!storedTask || storedTask.value.state !== 'deferred') {
    return options.workingContext;
  }

  if (
    options.dueAt != null &&
    storedTask.value.dueAt != null &&
    storedTask.value.dueAt > options.dueAt
  ) {
    return options.workingContext;
  }

  const completedTask = withTaskProgressSummary(
    transitionTaskState(storedTask.value, 'completed', options.completedAt),
    {
      headline: `Handled: ${storedTask.value.requestedOutcome}`,
      detail: 'Handled during due-task review.',
      waitingForUser: false,
      lastActor: 'head',
    },
    options.completedAt,
  );
  const completed = await options.repositories.tasks.completeDeferredTask({
    task: completedTask,
    taskEtag: storedTask.etag,
    workingContext: buildCompletedDueTaskWorkingContext({
      completedAt: options.completedAt,
      taskId: storedTask.value.id,
      workingContext: options.workingContext.value,
    }),
    workingContextEtag: options.workingContext.etag,
  });

  return completed.workingContext;
}

export function createHeadRuntimeService(options: {
  approvalLifecycleService: ApprovalLifecycleService;
  auditHistoryService: AuditHistoryService;
  config: ApiRuntimeConfig;
  conversationMemoryService: ConversationMemoryService;
  credentialLifecycleService: CredentialLifecycleService;
  headRuntime: HeadRuntimeAdapter;
  logger: Logger;
  repositories: RepositoryBundle;
  repositoryConfig: RepositoryConfig;
  scheduleMutationService: ScheduleMutationService;
  taskQueueService: TaskQueueService;
  usageAccountingService: UsageAccountingService;
  workingContextSummaryService: WorkingContextSummaryService;
}): HeadService {
  return {
    async startTurn(input: HeadStartTurnRequest): Promise<HeadTurnExecutionResult> {
      options.logger.info('head_runtime.start_turn', {
        agentId: input.agentId,
        triggerKind: input.trigger.kind,
      });

      const startedAt = now();
      const storedAgent = await getRequiredAgent(options.repositories, input.agentId);
      const storedChannel = await getRequiredPrimaryChannel(options.repositories, storedAgent.value);
      const initialWorkingContext = await resolveCurrentWorkingContext({
        correlation: input.correlation,
        repositories: options.repositories,
        startedAt,
        storedAgent,
      });
      const triggerState = await loadTriggerState({
        agentId: storedAgent.value.id,
        channel: storedChannel.value,
        repositories: options.repositories,
        trigger: input.trigger,
      });

      const rejection = validateTurn({
        agent: storedAgent.value,
        channel: storedChannel.value,
        messages: triggerState.messages,
        request: input,
      });

      if (rejection) {
        const rejectedTurn = await options.repositories.execution.createHeadTurn(
          createRejectedHeadTurn({
            agentId: storedAgent.value.id,
            correlation: input.correlation,
            rejectedAt: now(),
            rejection,
            trigger: input.trigger,
            workingContext: initialWorkingContext.value,
          }),
        );

        await appendHeadTurnAuditSafe({
          action: 'head.turn.rejected',
          agentId: storedAgent.value.id,
          auditHistoryService: options.auditHistoryService,
          correlation: rejectedTurn.value.correlation,
          logger: options.logger,
          occurredAt: rejectedTurn.value.updatedAt,
          outcome: 'denied',
          summary: rejection.message,
          turn: rejectedTurn.value,
        });

        return headTurnExecutionResultSchema.parse({
          headTurn: rejectedTurn.value,
          status: 'rejected',
          replyDraft: null,
          effectSummary: createEmptyEffectSummary(),
        });
      }

      let claimedWorkingContext: StoredRecord<WorkingContext> | null = null;
      let createdHeadTurn: StoredRecord<HeadTurn> | null = null;

      for (let attempt = 0; attempt < HEAD_TURN_CLAIM_RETRY_LIMIT; attempt += 1) {
        let storedWorkingContext = await resolveCurrentWorkingContext({
          correlation: input.correlation,
          repositories: options.repositories,
          startedAt: now(),
          storedAgent,
        });
        const claimTime = now();

        if (
          shouldRotateEpisode({
            episodeLocalDate: storedWorkingContext.value.episodeLocalDate,
            episodeTurnCount: storedWorkingContext.value.episodeTurnCount,
            eventAt: claimTime,
            timeZone: storedAgent.value.timeZone,
          })
        ) {
          try {
            storedWorkingContext = await options.repositories.workingContexts.replace(
              applyEpisodeRotation({
                eventAt: claimTime,
                timeZone: storedAgent.value.timeZone,
                workingContext: storedWorkingContext.value,
              }),
              storedWorkingContext.etag,
            );
          } catch (error) {
            if (error instanceof OptimisticConcurrencyError) {
              continue;
            }

            throw error;
          }
        }

        if (storedWorkingContext.value.activeHeadTurnId != null) {
          const activeHeadTurn = await options.repositories.execution.getHeadTurn(
            storedAgent.value.id,
            storedWorkingContext.value.activeHeadTurnId,
          );

          if (
            !activeHeadTurn ||
            activeHeadTurn.value.state === 'completed' ||
            activeHeadTurn.value.state === 'failed' ||
            activeHeadTurn.value.state === 'superseded'
          ) {
            try {
              await options.repositories.workingContexts.replace(
                clearHeadTurnClaim({
                  releasedAt: claimTime,
                  workingContext: storedWorkingContext.value,
                }),
                storedWorkingContext.etag,
              );
            } catch (error) {
              if (error instanceof OptimisticConcurrencyError) {
                continue;
              }

              throw error;
            }

            continue;
          }

          throw new ConflictError(
            `Agent ${storedAgent.value.id} already has an active Head turn.`,
          );
        }

        const headTurnDraft = createRunningHeadTurn({
          agentId: storedAgent.value.id,
          correlation: input.correlation,
          createdAt: claimTime,
          episodeLocalDate: storedWorkingContext.value.episodeLocalDate,
          episodeTurnIndex: storedWorkingContext.value.episodeTurnCount + 1,
          headTurnId: createRuntimeIdentifier('hdr'),
          trigger: input.trigger,
          workingContext: storedWorkingContext.value,
        });

        try {
          const claimResult = await options.repositories.execution.claimHeadTurn({
            headTurn: headTurnDraft,
            workingContext: applyHeadTurnClaim({
              claimedAt: claimTime,
              headTurnId: headTurnDraft.id,
              readThroughSequence: headTurnDraft.readThroughMessageSequence,
              workingContext: storedWorkingContext.value,
            }),
            workingContextEtag: storedWorkingContext.etag,
          });

          createdHeadTurn = claimResult.headTurn;
          claimedWorkingContext = claimResult.workingContext;
          break;
        } catch (error) {
          if (error instanceof OptimisticConcurrencyError) {
            continue;
          }

          throw error;
        }
      }

      if (!createdHeadTurn || !claimedWorkingContext) {
        throw new ConflictError(
          `Unable to claim an authoritative Head turn for agent ${storedAgent.value.id}.`,
        );
      }

      const activeHeadTurns = await options.repositories.execution.listActiveHeadTurns(
        storedAgent.value.id,
      );
      const memoryContext = await options.conversationMemoryService.loadTurnContext({
        agent: storedAgent.value,
        channel: storedChannel.value,
        messages: triggerState.messages,
        modelInput: triggerState.modelInput,
        repositoryConfig: options.repositoryConfig,
        trigger: input.trigger,
      });
      const toolCatalog = createHeadToolCatalog({
        activeHeadTurnCount: activeHeadTurns.length,
        agent: storedAgent.value,
        approvalLifecycleService: options.approvalLifecycleService,
        channel: storedChannel.value,
        conversationMemoryService: options.conversationMemoryService,
        credentialLifecycleService: options.credentialLifecycleService,
        headTurn: createdHeadTurn.value,
        memoryContext,
        repositoryConfig: options.repositoryConfig,
        scheduleMutationService: options.scheduleMutationService,
        taskQueueService: options.taskQueueService,
        workingContext: claimedWorkingContext.value,
      });
      const prompt = buildHeadPrompt({
        agent: storedAgent.value,
        alwaysVisibleCapabilityIds: toolCatalog.visibleCapabilityIds,
        durableMemories: memoryContext.promptMemories,
        enabledTools: toolCatalog.promptTools,
        latestTrustedMessageText: triggerState.latestTrustedMessageText,
        repositoryConfig: options.repositoryConfig,
        runtimeMode: options.config.runtimeMode,
        trustedChannel: {
          provider: storedChannel.value.provider,
          ...(storedChannel.value.externalHandle
            ? { externalHandle: storedChannel.value.externalHandle }
            : {}),
        },
        trigger: input.trigger,
        webSearchEnabled: true,
        workingContext: claimedWorkingContext.value,
        ...(triggerState.dueTaskContext
          ? { dueTaskContext: triggerState.dueTaskContext }
          : {}),
      });

      let committedMemoryUpdateIds: string[] = [];

      try {
        const requestedModel = resolveHeadRuntimeModel({
          agent: storedAgent.value,
          runtimeMode: options.config.runtimeMode,
        });
        const runtimeResult = await options.headRuntime.executeTurn({
          agentId: storedAgent.value.id,
          capabilitySummary: buildCapabilitySummary({
            enabledToolNames: toolCatalog.enabledTools.map((tool) => tool.name),
            registry: options.repositoryConfig.capabilities.registry,
            visibleCapabilityIds: toolCatalog.visibleCapabilityIds,
          }),
          conversationCursor: claimedWorkingContext.value.conversationCursor ?? null,
          correlation: createdHeadTurn.value.correlation,
          enabledTools: toolCatalog.enabledTools,
          headTurnId: createdHeadTurn.value.id,
          modelInput: triggerState.modelInput,
          prompt,
          webSearchEnabled: true,
          ...(requestedModel ? { model: requestedModel } : {}),
        });
        const staleCheckedAt = now();
        const latestHeadTurn = await loadHeadTurnForAgent({
          agentId: storedAgent.value.id,
          headTurnId: createdHeadTurn.value.id,
          repositories: options.repositories,
        });
        const latestWorkingContext = await resolveCurrentWorkingContext({
          correlation: input.correlation,
          repositories: options.repositories,
          startedAt: staleCheckedAt,
          storedAgent,
        });

        if (
          latestHeadTurn.value.state === 'superseded' ||
          isTurnSuperseded({
            headTurn: latestHeadTurn.value,
            workingContext: latestWorkingContext.value,
          })
        ) {
          if (latestHeadTurn.value.state !== 'superseded') {
            const supersededAt = now();
            const supersededBySequence =
              latestWorkingContext.value.latestInboundSequence >
              (latestHeadTurn.value.readThroughMessageSequence ?? 0)
                ? latestWorkingContext.value.latestInboundSequence
                : latestHeadTurn.value.supersededBySequence ?? 0;
            const supersededWorkingContext =
              latestWorkingContext.value.activeHeadTurnId === latestHeadTurn.value.id
                ? applyHeadTurnSuperseded({
                    headTurnId: latestHeadTurn.value.id,
                    supersededAt,
                    supersededBySequence,
                    workingContext: latestWorkingContext.value,
                  })
                : undefined;

            const supersededResult = await options.repositories.execution.supersedeHeadTurn({
              headTurn: {
                ...latestHeadTurn.value,
                updatedAt: supersededAt,
                completedAt: supersededAt,
                staleCheckedAt,
                state: 'superseded',
                supersededBySequence,
                providerConversationId: runtimeResult.providerConversationId,
                providerRunId: runtimeResult.providerRunId,
                memorySearchId: memoryContext.lastSearchId,
                memoryUpdateIds: [],
                promptProfileVersion: prompt.promptProfileVersion,
              },
              headTurnEtag: latestHeadTurn.etag,
              ...(supersededWorkingContext
                ? {
                    workingContext: supersededWorkingContext,
                    workingContextEtag: latestWorkingContext.etag,
                  }
                : {}),
            });

            await appendHeadTurnAuditSafe({
              action: 'head.turn.superseded',
              agentId: storedAgent.value.id,
              auditHistoryService: options.auditHistoryService,
              correlation: supersededResult.headTurn.value.correlation,
              logger: options.logger,
              occurredAt: supersededAt,
              outcome: 'cancelled',
              summary: `Head turn '${supersededResult.headTurn.value.id}' was superseded by newer input.`,
              turn: supersededResult.headTurn.value,
            });

            return headTurnExecutionResultSchema.parse({
              headTurn: supersededResult.headTurn.value,
              status: 'superseded',
              replyDraft: null,
              effectSummary: createEmptyEffectSummary(),
            });
          }

          return headTurnExecutionResultSchema.parse({
            headTurn: latestHeadTurn.value,
            status: 'superseded',
            replyDraft: null,
            effectSummary: createEmptyEffectSummary(),
          });
        }

        if (runtimeResult.completionKind === 'failed') {
          const failedAt = now();
          const failedResult = await options.repositories.execution.finalizeHeadTurn({
            headTurn: {
              ...latestHeadTurn.value,
              updatedAt: failedAt,
              completedAt: failedAt,
              staleCheckedAt,
              state: 'failed',
              providerConversationId: runtimeResult.providerConversationId,
              providerRunId: runtimeResult.providerRunId,
              memorySearchId: memoryContext.lastSearchId,
              memoryUpdateIds: [],
              promptProfileVersion: prompt.promptProfileVersion,
              completionKind: 'failed',
              failureCode: 'foundry_execution_failed',
              failureMessage: 'Foundry execution returned a failed completion.',
            },
            headTurnEtag: latestHeadTurn.etag,
            workingContext: clearHeadTurnClaim({
              releasedAt: failedAt,
              workingContext: latestWorkingContext.value,
            }),
            workingContextEtag: latestWorkingContext.etag,
          });

          if (runtimeResult.usage) {
            const usage = runtimeResult.usage;
            await appendUsageSafe({
              usageAccountingService: options.usageAccountingService,
              logger: options.logger,
              append: () =>
                options.usageAccountingService.appendUsage({
                  agentId: storedAgent.value.id,
                  analyticsGroup: usage.analyticsGroup,
                  correlation: failedResult.headTurn.value.correlation,
                  model: storedAgent.value.headModel,
                  occurredAt: failedAt,
                  operation: 'head_turn',
                  provider: usage.provider,
                  providerOperationId: usage.providerOperationId,
                  source: 'head',
                  tokens: usage.tokens,
                }),
              agentId: storedAgent.value.id,
              operation: 'head_turn',
              source: 'head',
            });
          }

          await appendHeadTurnAuditSafe({
            action: 'head.turn.failed',
            agentId: storedAgent.value.id,
            auditHistoryService: options.auditHistoryService,
            correlation: failedResult.headTurn.value.correlation,
            logger: options.logger,
            occurredAt: failedAt,
            outcome: 'failed',
            summary: 'Foundry execution returned a failed completion.',
            turn: failedResult.headTurn.value,
          });

          return headTurnExecutionResultSchema.parse({
            headTurn: failedResult.headTurn.value,
            status: 'failed',
            replyDraft: null,
            effectSummary: createEmptyEffectSummary(),
          });
        }

        const completedAt = now();
        const reconciledWorkingContext =
          input.trigger.kind === 'due_task'
            ? await reconcileDueTaskBeforeCommit({
                completedAt,
                dueAt: latestHeadTurn.value.dueAt,
                repositories: options.repositories,
                taskId: latestHeadTurn.value.taskId,
                workingContext: latestWorkingContext,
              })
            : latestWorkingContext;
        const summarySnapshot =
          input.trigger.kind === 'trusted_messages'
            ? await options.workingContextSummaryService.refreshAfterTrustedTurn({
                agent: storedAgent.value,
                assistantReplyText: runtimeResult.assistantText,
                completedAt,
                trigger: input.trigger,
                trustedMessages: triggerState.messages,
                workingContext: reconciledWorkingContext.value,
              })
            : buildExistingSummarySnapshot(reconciledWorkingContext.value, completedAt);
        if (input.trigger.kind === 'trusted_messages') {
          committedMemoryUpdateIds = (
            await options.conversationMemoryService.commitWrites({
              candidates: collectDeferredMemoryWrites(runtimeResult.deferredDirectives),
              context: memoryContext,
            })
          ).updateIds;
        }
        const finalizedWorkingContext = applyHeadTurnCommitted({
          assistantSummary: summarySnapshot,
          completedAt,
          conversationCursor: runtimeResult.conversationCursor,
          incrementEpisodeTurnCount: true,
          readThroughSequence: latestHeadTurn.value.readThroughMessageSequence,
          workingContext: reconciledWorkingContext.value,
        });
        const finalizedTurn = await options.repositories.execution.finalizeHeadTurn({
          headTurn: {
            ...latestHeadTurn.value,
            updatedAt: completedAt,
            completedAt,
            staleCheckedAt,
            state: 'completed',
            providerConversationId: runtimeResult.providerConversationId,
            providerRunId: runtimeResult.providerRunId,
            memorySearchId: memoryContext.lastSearchId,
            memoryUpdateIds: committedMemoryUpdateIds,
            promptProfileVersion: prompt.promptProfileVersion,
            completionKind: runtimeResult.completionKind,
            failureCode: undefined,
            failureMessage: undefined,
          },
          headTurnEtag: latestHeadTurn.etag,
          workingContext: finalizedWorkingContext,
          workingContextEtag: reconciledWorkingContext.etag,
        });

        if (runtimeResult.usage) {
          const usage = runtimeResult.usage;
          await appendUsageSafe({
            usageAccountingService: options.usageAccountingService,
            logger: options.logger,
            append: () =>
              options.usageAccountingService.appendUsage({
                agentId: storedAgent.value.id,
                analyticsGroup: usage.analyticsGroup,
                correlation: finalizedTurn.headTurn.value.correlation,
                model: storedAgent.value.headModel,
                occurredAt: completedAt,
                operation: 'head_turn',
                provider: usage.provider,
                providerOperationId: usage.providerOperationId,
                source: 'head',
                tokens: usage.tokens,
              }),
            agentId: storedAgent.value.id,
            operation: 'head_turn',
            source: 'head',
          });
        }

        if (summarySnapshot.usage) {
          const usage = summarySnapshot.usage;
          await appendUsageSafe({
            usageAccountingService: options.usageAccountingService,
            logger: options.logger,
            append: () =>
              options.usageAccountingService.appendUsage({
                agentId: storedAgent.value.id,
                analyticsGroup: usage.analyticsGroup,
                correlation: finalizedTurn.headTurn.value.correlation,
                model: storedAgent.value.headModel,
                occurredAt: completedAt,
                operation: 'working_context_summary',
                provider: usage.provider,
                providerOperationId: usage.providerOperationId,
                source: 'head',
                tokens: usage.tokens,
              }),
            agentId: storedAgent.value.id,
            operation: 'working_context_summary',
            source: 'head',
          });
        }

        await appendHeadTurnAuditSafe({
          action: 'head.turn.completed',
          agentId: storedAgent.value.id,
          auditHistoryService: options.auditHistoryService,
          correlation: finalizedTurn.headTurn.value.correlation,
          logger: options.logger,
          occurredAt: completedAt,
          outcome: 'succeeded',
          summary: `Head turn '${finalizedTurn.headTurn.value.id}' completed with '${runtimeResult.completionKind}'.`,
          turn: finalizedTurn.headTurn.value,
        });

        return headTurnExecutionResultSchema.parse({
          headTurn: finalizedTurn.headTurn.value,
          status: mapCompletionKindToStatus(runtimeResult.completionKind),
          replyDraft: createReplyDraft({
            agentId: storedAgent.value.id,
            assistantText: runtimeResult.assistantText,
            channel: storedChannel.value,
            inReplyToInboundMessageId: triggerState.inReplyToInboundMessageId,
          }),
          effectSummary: runtimeResult.effectSummary,
        });
      } catch (error) {
        const failedAt = now();
        const latestHeadTurn = await loadHeadTurnForAgent({
          agentId: storedAgent.value.id,
          headTurnId: createdHeadTurn.value.id,
          repositories: options.repositories,
        });
        const latestWorkingContext = await resolveCurrentWorkingContext({
          correlation: input.correlation,
          repositories: options.repositories,
          startedAt: failedAt,
          storedAgent,
        });

        if (
          latestHeadTurn.value.state === 'superseded' ||
          isTurnSuperseded({
            headTurn: latestHeadTurn.value,
            workingContext: latestWorkingContext.value,
          })
        ) {
          return headTurnExecutionResultSchema.parse({
            headTurn: latestHeadTurn.value,
            status: 'superseded',
            replyDraft: null,
            effectSummary: createEmptyEffectSummary(),
          });
        }

        const failedResult = await options.repositories.execution.finalizeHeadTurn({
          headTurn: {
            ...latestHeadTurn.value,
            updatedAt: failedAt,
            completedAt: failedAt,
            staleCheckedAt: failedAt,
            state: 'failed',
            memorySearchId: memoryContext.lastSearchId,
            memoryUpdateIds: committedMemoryUpdateIds,
            completionKind: 'failed',
            failureCode: 'foundry_execution_failed',
            failureMessage:
              error instanceof Error ? error.message : 'Foundry execution failed unexpectedly.',
          },
          headTurnEtag: latestHeadTurn.etag,
          workingContext: clearHeadTurnClaim({
            releasedAt: failedAt,
            workingContext: latestWorkingContext.value,
          }),
          workingContextEtag: latestWorkingContext.etag,
        });

        await appendHeadTurnAuditSafe({
          action: 'head.turn.failed',
          agentId: storedAgent.value.id,
          auditHistoryService: options.auditHistoryService,
          correlation: failedResult.headTurn.value.correlation,
          logger: options.logger,
          occurredAt: failedAt,
          outcome: 'failed',
          summary:
            error instanceof Error ? error.message : 'Foundry execution failed unexpectedly.',
          turn: failedResult.headTurn.value,
        });

        return headTurnExecutionResultSchema.parse({
          headTurn: failedResult.headTurn.value,
          status: 'failed',
          replyDraft: null,
          effectSummary: createEmptyEffectSummary(),
        });
      }
    },

    async supersedeTurn(input: HeadSupersedeTurnRequest): Promise<HeadTurn> {
      options.logger.info('head_runtime.supersede_turn', { headTurnId: input.headTurnId });
      const storedHeadTurn = await options.repositories.execution.findHeadTurn(input.headTurnId);
      if (!storedHeadTurn) {
        throw new NotFoundError('Head turn not found.');
      }

      if (storedHeadTurn.value.state === 'completed' || storedHeadTurn.value.state === 'failed') {
        return storedHeadTurn.value;
      }

      if (storedHeadTurn.value.providerRunId) {
        try {
          await options.headRuntime.cancelTurn({
            providerRunId: storedHeadTurn.value.providerRunId,
          });
        } catch (error) {
          options.logger.warn('head_runtime.cancel_turn_failed', {
            headTurnId: storedHeadTurn.value.id,
            message: error instanceof Error ? error.message : 'Unknown cancel error.',
          });
        }
      }

      const supersededAt = now();
      const storedWorkingContext = await options.repositories.workingContexts.get(
        storedHeadTurn.value.agentId,
        storedHeadTurn.value.workingContextId,
      );
      const supersededResult = await options.repositories.execution.supersedeHeadTurn({
        headTurn: {
          ...storedHeadTurn.value,
          updatedAt: supersededAt,
          completedAt: storedHeadTurn.value.completedAt ?? supersededAt,
          staleCheckedAt: storedHeadTurn.value.staleCheckedAt ?? supersededAt,
          state: 'superseded',
          supersededBySequence: input.supersededBySequence,
        },
        headTurnEtag: storedHeadTurn.etag,
        ...(storedWorkingContext &&
        storedWorkingContext.value.activeHeadTurnId === storedHeadTurn.value.id
          ? {
              workingContext: applyHeadTurnSuperseded({
                headTurnId: storedHeadTurn.value.id,
                supersededAt,
                supersededBySequence: input.supersededBySequence,
                workingContext: storedWorkingContext.value,
              }),
              workingContextEtag: storedWorkingContext.etag,
            }
          : {}),
      });

      await appendHeadTurnAuditSafe({
        action: 'head.turn.superseded',
        agentId: storedHeadTurn.value.agentId,
        auditHistoryService: options.auditHistoryService,
        correlation: storedHeadTurn.value.correlation,
        logger: options.logger,
        occurredAt: supersededAt,
        outcome: 'cancelled',
        summary: `Head turn '${storedHeadTurn.value.id}' was manually superseded.`,
        turn: supersededResult.headTurn.value,
      });

      return supersededResult.headTurn.value;
    },
  };
}

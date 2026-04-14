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
  WorkingContext,
} from '@echidna-claw/contracts';
import { headTurnExecutionResultSchema } from '@echidna-claw/contracts';
import { isAgentOperational } from '@echidna-claw/domain';
import type { Logger } from '@echidna-claw/observability';
import {
  HEAD_BASE_PROMPT_PROFILE_VERSION,
  buildCapabilitySummary,
  buildHeadPrompt,
} from '@echidna-claw/prompting';
import type { StoredRecord } from '@echidna-claw/persistence';

import type { HeadRuntimeAdapter } from '../../adapters/foundry/index.js';
import type { ApiRuntimeConfig } from '../../config/api-runtime-config.js';
import type { RepositoryBundle } from '../../adapters/repositories/index.js';
import { NotFoundError } from '../../http/errors.js';
import { createHeadToolCatalog } from './head-tool-catalog.js';
import type { TaskQueueService } from './task-queue-service.js';

type TriggerLoadResult = {
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

function createRuntimeIdentifier(prefix: 'hdr'): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

function createEmptyEffectSummary(): HeadEffectSummary {
  return {
    taskRequested: false,
    scheduleChangeRequested: false,
    approvalRequested: false,
    sandboxRequested: false,
    memoryOperationRequested: false,
  };
}

function createWorkingContextRecord(input: {
  agentId: string;
  correlation: HeadStartTurnRequest['correlation'];
  createdAt: string;
  workingContextId: string;
}): WorkingContext {
  return {
    id: input.workingContextId,
    recordType: 'working_context',
    schemaVersion: 1,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    correlation: input.correlation,
    agentId: input.agentId,
    lastTrustedMessageSequence: 0,
    activeHeadTurnId: null,
    activeTaskId: null,
    summary: '',
    conversationCursor: undefined,
    openTaskIds: [],
    pendingApprovalIds: [],
  };
}

function createRunningHeadTurn(input: {
  agentId: string;
  correlation: HeadStartTurnRequest['correlation'];
  createdAt: string;
  headTurnId: string;
  trigger: HeadStartTurnRequest['trigger'];
  workingContextId: string;
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
    workingContextId: input.workingContextId,
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
    startedAt: input.createdAt,
    completedAt: null,
    supersededBySequence: null,
    providerConversationId: input.workingContext.conversationCursor ?? null,
    providerRunId: null,
    promptProfileVersion: HEAD_BASE_PROMPT_PROFILE_VERSION,
    completionKind: null,
    failureCode: undefined,
    failureMessage: undefined,
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
  requestedWorkingContextId: string;
  startedAt: string;
  storedAgent: StoredRecord<Agent>;
}): Promise<StoredRecord<WorkingContext>> {
  const existing = await options.repositories.workingContexts.get(
    options.storedAgent.value.id,
    options.requestedWorkingContextId,
  );
  if (existing) {
    return existing;
  }

  const byAgent = await options.repositories.workingContexts.getByAgent(options.storedAgent.value.id);
  if (byAgent) {
    if (byAgent.value.id !== options.requestedWorkingContextId) {
      throw new NotFoundError('Working context not found for the requested id.');
    }

    return byAgent;
  }

  return options.repositories.workingContexts.create(
    createWorkingContextRecord({
      agentId: options.storedAgent.value.id,
      correlation: options.correlation,
      createdAt: options.startedAt,
      workingContextId: options.requestedWorkingContextId,
    }),
  );
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

export function createHeadRuntimeService(options: {
  config: ApiRuntimeConfig;
  headRuntime: HeadRuntimeAdapter;
  logger: Logger;
  repositories: RepositoryBundle;
  repositoryConfig: RepositoryConfig;
  taskQueueService: TaskQueueService;
}): HeadService {
  return {
    async startTurn(input: HeadStartTurnRequest): Promise<HeadTurnExecutionResult> {
      options.logger.info('head_runtime.start_turn', {
        agentId: input.agentId,
        workingContextId: input.workingContextId,
        triggerKind: input.trigger.kind,
      });

      const startedAt = now();
      const storedAgent = await getRequiredAgent(options.repositories, input.agentId);
      const storedChannel = await getRequiredPrimaryChannel(options.repositories, storedAgent.value);
      const storedWorkingContext = await getOrCreateWorkingContext({
        correlation: input.correlation,
        repositories: options.repositories,
        requestedWorkingContextId: input.workingContextId,
        startedAt,
        storedAgent,
      });
      const triggerState = await loadTriggerState({
        agentId: storedAgent.value.id,
        channel: storedChannel.value,
        repositories: options.repositories,
        trigger: input.trigger,
      });
      const createdHeadTurn = await options.repositories.execution.createHeadTurn(
        createRunningHeadTurn({
          agentId: storedAgent.value.id,
          correlation: input.correlation,
          createdAt: startedAt,
          headTurnId: createRuntimeIdentifier('hdr'),
          trigger: input.trigger,
          workingContext: storedWorkingContext.value,
          workingContextId: storedWorkingContext.value.id,
        }),
      );

      const rejection = validateTurn({
        agent: storedAgent.value,
        channel: storedChannel.value,
        messages: triggerState.messages,
        request: input,
      });

      if (rejection) {
        const rejectedAt = now();
        const rejectedTurn = await options.repositories.execution.replaceHeadTurn(
          {
            ...createdHeadTurn.value,
            updatedAt: rejectedAt,
            completedAt: rejectedAt,
            state: 'completed',
            completionKind: 'rejected',
            failureCode: rejection.code,
            failureMessage: rejection.message,
          },
          createdHeadTurn.etag,
        );

        return headTurnExecutionResultSchema.parse({
          headTurn: rejectedTurn.value,
          status: 'rejected',
          replyDraft: null,
          effectSummary: createEmptyEffectSummary(),
        });
      }

      const activeContext = await options.repositories.workingContexts.replace(
        {
          ...storedWorkingContext.value,
          activeHeadTurnId: createdHeadTurn.value.id,
          updatedAt: startedAt,
        },
        storedWorkingContext.etag,
      );

      const activeHeadTurns = await options.repositories.execution.listActiveHeadTurns(
        storedAgent.value.id,
      );
      const toolCatalog = createHeadToolCatalog({
        activeHeadTurnCount: activeHeadTurns.length,
        agent: storedAgent.value,
        channel: storedChannel.value,
        headTurn: createdHeadTurn.value,
        repositoryConfig: options.repositoryConfig,
        taskQueueService: options.taskQueueService,
        workingContext: activeContext.value,
      });
      const prompt = buildHeadPrompt({
        agent: storedAgent.value,
        alwaysVisibleCapabilityIds: toolCatalog.visibleCapabilityIds,
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
        workingContext: activeContext.value,
      });

      try {
        const runtimeResult = await options.headRuntime.executeTurn({
          agentId: storedAgent.value.id,
          capabilitySummary: buildCapabilitySummary({
            enabledToolNames: toolCatalog.enabledTools.map((tool) => tool.name),
            registry: options.repositoryConfig.capabilities.registry,
            visibleCapabilityIds: toolCatalog.visibleCapabilityIds,
          }),
          conversationCursor: activeContext.value.conversationCursor ?? null,
          correlation: createdHeadTurn.value.correlation,
          enabledTools: toolCatalog.enabledTools,
          headTurnId: createdHeadTurn.value.id,
          model: storedAgent.value.headModel,
          modelInput: triggerState.modelInput,
          prompt,
          webSearchEnabled: true,
        });
        const completedAt = now();
        const finalizedTurn = await options.repositories.execution.replaceHeadTurn(
          {
            ...createdHeadTurn.value,
            updatedAt: completedAt,
            completedAt,
            state: runtimeResult.completionKind === 'failed' ? 'failed' : 'completed',
            providerConversationId: runtimeResult.providerConversationId,
            providerRunId: runtimeResult.providerRunId,
            promptProfileVersion: prompt.promptProfileVersion,
            completionKind: runtimeResult.completionKind,
            failureCode: undefined,
            failureMessage: undefined,
          },
          createdHeadTurn.etag,
        );
        const latestWorkingContext = await options.repositories.workingContexts.get(
          storedAgent.value.id,
          activeContext.value.id,
        );
        await options.repositories.workingContexts.replace(
          {
            ...(latestWorkingContext?.value ?? activeContext.value),
            activeHeadTurnId: null,
            conversationCursor: runtimeResult.conversationCursor ?? undefined,
            lastTrustedMessageSequence:
              input.trigger.kind === 'trusted_messages'
                ? input.trigger.readThroughMessageSequence
                : (latestWorkingContext?.value.lastTrustedMessageSequence ??
                  activeContext.value.lastTrustedMessageSequence),
            updatedAt: completedAt,
          },
          latestWorkingContext?.etag ?? activeContext.etag,
        );

        return headTurnExecutionResultSchema.parse({
          headTurn: finalizedTurn.value,
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
        const failedTurn = await options.repositories.execution.replaceHeadTurn(
          {
            ...createdHeadTurn.value,
            updatedAt: failedAt,
            completedAt: failedAt,
            state: 'failed',
            completionKind: 'failed',
            failureCode: 'foundry_execution_failed',
            failureMessage:
              error instanceof Error ? error.message : 'Foundry execution failed unexpectedly.',
          },
          createdHeadTurn.etag,
        );
        const latestWorkingContext = await options.repositories.workingContexts.get(
          storedAgent.value.id,
          activeContext.value.id,
        );
        await options.repositories.workingContexts.replace(
          {
            ...(latestWorkingContext?.value ?? activeContext.value),
            activeHeadTurnId: null,
            updatedAt: failedAt,
          },
          latestWorkingContext?.etag ?? activeContext.etag,
        );

        return headTurnExecutionResultSchema.parse({
          headTurn: failedTurn.value,
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
      const updatedTurn = await options.repositories.execution.replaceHeadTurn(
        {
          ...storedHeadTurn.value,
          updatedAt: supersededAt,
          completedAt: storedHeadTurn.value.completedAt ?? supersededAt,
          state: 'superseded',
          supersededBySequence: input.supersededBySequence,
        },
        storedHeadTurn.etag,
      );
      const storedWorkingContext = await options.repositories.workingContexts.get(
        storedHeadTurn.value.agentId,
        storedHeadTurn.value.workingContextId,
      );

      if (storedWorkingContext && storedWorkingContext.value.activeHeadTurnId === storedHeadTurn.value.id) {
        await options.repositories.workingContexts.replace(
          {
            ...storedWorkingContext.value,
            activeHeadTurnId: null,
            updatedAt: supersededAt,
          },
          storedWorkingContext.etag,
        );
      }

      return updatedTurn.value;
    },
  };
}

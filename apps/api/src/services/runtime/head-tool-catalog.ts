import type {
  Agent,
  Channel,
  HeadEffectSummary,
  HeadTurn,
  RepositoryConfig,
  WorkingContext,
} from '@echidna-claw/contracts';
import type { PromptToolDescriptor } from '@echidna-claw/prompting';
import { z } from 'zod';

import type { PreparedHeadTool } from '../../adapters/foundry/index.js';
import {
  changeScheduleToolInputSchema,
  handleChangeSchedule,
} from './head-tool-handlers/change-schedule.js';
import { handleCreateTask } from './head-tool-handlers/create-task.js';
import { handleDescribeCapabilities } from './head-tool-handlers/describe-capabilities.js';
import { handleReadStatus } from './head-tool-handlers/read-status.js';
import { handleRequestApproval } from './head-tool-handlers/request-approval.js';
import { handleRequestCredential } from './head-tool-handlers/request-credential.js';
import type { ApprovalLifecycleService } from './approval-lifecycle-service.js';
import type { CredentialLifecycleService } from './credential-lifecycle-service.js';
import type { ScheduleMutationService } from './schedule-mutation-service.js';
import type { TaskQueueService } from './task-queue-service.js';

type HeadToolName =
  | 'read_status'
  | 'describe_capabilities'
  | 'create_task'
  | 'change_schedule'
  | 'request_approval'
  | 'request_credential'
  | 'memory_read'
  | 'memory_write'
  | 'invoke_sandbox';

type ToolDefinition = {
  capabilityId?: string;
  description: string;
  enabled: boolean;
  execute?: (args: unknown) => Promise<{
    effectSummaryPatch?: Partial<HeadEffectSummary>;
    outputText: string;
  }>;
  inputSchema: Record<string, unknown>;
  name: HeadToolName;
};

export interface HeadToolCatalog {
  definedTools: ToolDefinition[];
  enabledTools: PreparedHeadTool[];
  promptTools: PromptToolDescriptor[];
  visibleCapabilityIds: string[];
}

function emptyObjectSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {},
    additionalProperties: false,
  };
}

export function createHeadToolCatalog(input: {
  activeHeadTurnCount: number;
  agent: Agent;
  approvalLifecycleService: ApprovalLifecycleService;
  channel: Channel;
  credentialLifecycleService: CredentialLifecycleService;
  headTurn: HeadTurn;
  repositoryConfig: RepositoryConfig;
  scheduleMutationService: ScheduleMutationService;
  taskQueueService: TaskQueueService;
  workingContext: WorkingContext;
}): HeadToolCatalog {
  const definedTools: ToolDefinition[] = [
    {
      description: 'Summarize the agent runtime state from structured working-context data.',
      enabled: true,
      execute: async (args) => {
        const parsedArgs = z
          .object({
            focus: z.enum(['summary', 'tasks', 'approvals', 'credentials']).optional(),
          })
          .strict()
          .parse(args);
        const snapshot = await input.taskQueueService.getTaskStatusSnapshot({
          agentId: input.agent.id,
          workingContextId: input.workingContext.id,
        });

        return {
          outputText: handleReadStatus({
            activeHeadTurnCount: input.activeHeadTurnCount,
            headTurn: input.headTurn,
            snapshot,
            ...(parsedArgs.focus ? { focus: parsedArgs.focus } : {}),
          }),
        };
      },
      inputSchema: {
        type: 'object',
        properties: {
          focus: {
            type: 'string',
            enum: ['summary', 'tasks', 'approvals', 'credentials'],
          },
        },
        required: ['focus'],
        additionalProperties: false,
      },
      name: 'read_status',
    },
    {
      description: 'Describe currently enabled user-facing capabilities conservatively.',
      enabled: true,
      execute: async () => ({
        outputText: handleDescribeCapabilities({
          enabledToolNames: ['read_status', 'describe_capabilities'],
          registry: input.repositoryConfig.capabilities.registry,
          visibleCapabilityIds: input.channel.provider === 'telegram' && input.channel.state === 'active'
            ? ['telegram.messaging']
            : [],
        }),
      }),
      inputSchema: {
        type: 'object',
        properties: {
          detail_level: {
            type: 'string',
            enum: ['brief', 'full'],
          },
        },
        required: ['detail_level'],
        additionalProperties: false,
      },
      name: 'describe_capabilities',
    },
    {
      description: 'Create durable background work for the agent.',
      enabled: true,
      execute: async (args) =>
        handleCreateTask({
          args,
          headTurn: input.headTurn,
          taskQueueService: input.taskQueueService,
          workingContext: input.workingContext,
        }),
      inputSchema: {
        type: 'object',
        properties: {
          taskType: { type: 'string' },
          requestedOutcome: { type: 'string' },
          dueAt: { type: 'string' },
          notes: { type: 'string' },
          priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
        },
        required: ['taskType', 'requestedOutcome'],
        additionalProperties: false,
      },
      name: 'create_task',
    },
    {
      description: 'Create, update, pause, resume, or delete a recurring schedule.',
      enabled: true,
      execute: async (args) =>
        handleChangeSchedule({
          args,
          headTurn: input.headTurn,
          scheduleMutationService: input.scheduleMutationService,
        }),
      inputSchema: changeScheduleToolInputSchema,
      name: 'change_schedule',
    },
    {
      description: 'Request explicit user approval before performing a guarded action.',
      enabled: true,
      execute: async (args) =>
        handleRequestApproval({
          approvalLifecycleService: input.approvalLifecycleService,
          args,
          channelId: input.channel.id,
          headTurn: input.headTurn,
        }),
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          category: {
            type: 'string',
            enum: ['external_write', 'send', 'delete', 'purchase', 'credential_change', 'bulk_update', 'other'],
          },
          summary: { type: 'string' },
          actionFingerprint: { type: 'string' },
          expiresAt: { type: 'string' },
          blocking: { type: 'boolean' },
        },
        required: ['taskId', 'category', 'summary'],
        additionalProperties: false,
      },
      name: 'request_approval',
    },
    {
      description: 'Request a secure credential capture flow for a configured external service.',
      enabled: true,
      execute: async (args) =>
        handleRequestCredential({
          args,
          channelId: input.channel.id,
          credentialLifecycleService: input.credentialLifecycleService,
          headTurn: input.headTurn,
        }),
      inputSchema: {
        type: 'object',
        properties: {
          serviceAlias: { type: 'string' },
          reason: { type: 'string' },
          taskId: { type: 'string' },
        },
        required: ['serviceAlias'],
        additionalProperties: false,
      },
      name: 'request_credential',
    },
    {
      description: 'Read long-term memory for the current user or task.',
      enabled: false,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      name: 'memory_read',
    },
    {
      description: 'Write durable long-term memory for the current user or task.',
      enabled: false,
      inputSchema: {
        type: 'object',
        properties: {
          memory: { type: 'string' },
        },
        required: ['memory'],
        additionalProperties: false,
      },
      name: 'memory_write',
    },
    {
      capabilityId: 'sandbox.shell',
      description: 'Invoke the execution sandbox for trusted runtime work.',
      enabled: false,
      inputSchema: emptyObjectSchema(),
      name: 'invoke_sandbox',
    },
  ];

  const enabledTools = definedTools
    .filter(
      (tool): tool is ToolDefinition & { execute: NonNullable<ToolDefinition['execute']> } =>
        tool.enabled && tool.execute != null,
    )
    .map((tool) => ({
      description: tool.description,
      execute: tool.execute,
      inputSchema: tool.inputSchema,
      name: tool.name,
    }));

  const visibleCapabilityIds = [
    ...(input.channel.provider === 'telegram' && input.channel.state === 'active'
      ? ['telegram.messaging']
      : []),
    ...definedTools
      .filter((tool) => tool.enabled && tool.capabilityId != null)
      .map((tool) => tool.capabilityId!),
  ].sort((left, right) => left.localeCompare(right));

  return {
    definedTools,
    enabledTools,
    promptTools: enabledTools.map((tool) => ({
      description: tool.description,
      name: tool.name,
    })),
    visibleCapabilityIds,
  };
}

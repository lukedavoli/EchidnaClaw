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
import { handleCreateTask } from './head-tool-handlers/create-task.js';
import { handleDescribeCapabilities } from './head-tool-handlers/describe-capabilities.js';
import { handleReadStatus } from './head-tool-handlers/read-status.js';
import type { TaskQueueService } from './task-queue-service.js';

type HeadToolName =
  | 'read_status'
  | 'describe_capabilities'
  | 'create_task'
  | 'change_schedule'
  | 'request_approval'
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
  channel: Channel;
  headTurn: HeadTurn;
  repositoryConfig: RepositoryConfig;
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
            focus: z.enum(['summary', 'tasks', 'approvals']).optional(),
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
            enum: ['summary', 'tasks', 'approvals'],
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
      description: 'Create, update, or pause a schedule.',
      enabled: false,
      inputSchema: {
        type: 'object',
        properties: {
          request: { type: 'string' },
        },
        required: ['request'],
        additionalProperties: false,
      },
      name: 'change_schedule',
    },
    {
      description: 'Request explicit user approval before performing a guarded action.',
      enabled: false,
      inputSchema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
        },
        required: ['summary'],
        additionalProperties: false,
      },
      name: 'request_approval',
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

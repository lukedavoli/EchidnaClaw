import { AIProjectClient } from '@azure/ai-projects';
import { DefaultAzureCredential } from '@azure/identity';
import type { HeadEffectSummary } from '@echidna-claw/contracts';
import type {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
  Tool,
} from 'openai/resources/responses/responses';

import { DependencyUnavailableError } from '../../http/errors.js';
import type {
  DeferredHeadDirective,
  FoundryHeadTurnResult,
  HeadRuntimeAdapter,
  NormalizedProviderUsage,
  PreparedHeadTool,
  PreparedHeadTurnInput,
} from './types.js';

type OpenAIClient = ReturnType<AIProjectClient['getOpenAIClient']>;

const MAX_FUNCTION_TOOL_ROUNDS = 6;

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

function mergeEffectSummary(
  target: HeadEffectSummary,
  patch: Partial<HeadEffectSummary> | undefined,
): void {
  if (!patch) {
    return;
  }

  for (const key of Object.keys(target) as Array<keyof HeadEffectSummary>) {
    target[key] = target[key] || patch[key] === true;
  }
}

function buildFunctionToolDefinitions(enabledTools: PreparedHeadTool[]): Tool[] {
  return enabledTools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    strict: true,
    parameters: tool.inputSchema ?? {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  }));
}

function buildWebSearchTool(): Tool {
  return {
    type: 'web_search_preview',
    search_context_size: 'medium',
  };
}

function buildInputItems(input: PreparedHeadTurnInput): ResponseInputItem[] {
  return input.modelInput.map((item) => ({
    content: [
      {
        text: item.text,
        type: 'input_text',
      },
    ],
    role: item.role,
    type: 'message',
  }));
}

function hasFunctionCall(response: Response): boolean {
  return response.output.some((item) => item.type === 'function_call');
}

function toCompletionKind(input: {
  assistantText: string | null;
  hadFunctionCalls: boolean;
}): FoundryHeadTurnResult['completionKind'] {
  if (input.assistantText) {
    return 'reply';
  }

  return input.hadFunctionCalls ? 'tool_only' : 'no_op';
}

function extractUsage(
  response: Response,
  analyticsGroup: string,
): NormalizedProviderUsage | null {
  const usage = (response as Response & {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      input_token_details?: {
        cached_tokens?: number;
      };
      output_token_details?: {
        reasoning_tokens?: number;
      };
    };
  }).usage;

  if (!usage) {
    return null;
  }

  return {
    analyticsGroup,
    provider: 'azure-foundry',
    providerOperationId: response.id ?? null,
    tokens: {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      reasoningTokens: usage.output_token_details?.reasoning_tokens ?? null,
      toolInputTokens: usage.input_token_details?.cached_tokens ?? null,
      toolOutputTokens: null,
    },
  };
}

function mergeUsage(
  current: NormalizedProviderUsage | null,
  next: NormalizedProviderUsage | null,
): NormalizedProviderUsage | null {
  if (!current) {
    return next;
  }

  if (!next) {
    return current;
  }

  return {
    analyticsGroup: current.analyticsGroup ?? next.analyticsGroup,
    provider: current.provider,
    providerOperationId: next.providerOperationId ?? current.providerOperationId,
    tokens: {
      inputTokens: current.tokens.inputTokens + next.tokens.inputTokens,
      outputTokens: current.tokens.outputTokens + next.tokens.outputTokens,
      reasoningTokens:
        (current.tokens.reasoningTokens ?? 0) + (next.tokens.reasoningTokens ?? 0),
      toolInputTokens:
        (current.tokens.toolInputTokens ?? 0) + (next.tokens.toolInputTokens ?? 0),
      toolOutputTokens:
        (current.tokens.toolOutputTokens ?? 0) + (next.tokens.toolOutputTokens ?? 0),
    },
  };
}

async function resolveFunctionCalls(options: {
  defaultDeploymentName: string;
  openAIClient: OpenAIClient;
  response: Response;
  tools: readonly PreparedHeadTool[];
  turn: PreparedHeadTurnInput;
}): Promise<{
  deferredDirectives: DeferredHeadDirective[];
  effectSummary: HeadEffectSummary;
  finalResponse: Response;
  hadFunctionCalls: boolean;
  usage: NormalizedProviderUsage | null;
}> {
  const deferredDirectives: DeferredHeadDirective[] = [];
  const effectSummary = createEmptyEffectSummary();
  const toolsByName = new Map(options.tools.map((tool) => [tool.name, tool]));
  let hadFunctionCalls = false;
  let response = options.response;
  let usage = extractUsage(response, 'head-turn');

  for (let round = 0; round < MAX_FUNCTION_TOOL_ROUNDS; round += 1) {
    if (!hasFunctionCall(response)) {
      return {
        deferredDirectives,
        effectSummary,
        finalResponse: response,
        hadFunctionCalls,
        usage,
      };
    }

    hadFunctionCalls = true;
    const outputs: Array<{
      call_id: string;
      output: string;
      type: 'function_call_output';
    }> = [];

    for (const item of response.output) {
      if (item.type !== 'function_call') {
        continue;
      }

      const tool = toolsByName.get(item.name);
      if (!tool) {
        outputs.push({
          call_id: item.call_id,
          output: JSON.stringify({
            ok: false,
            error: `Tool '${item.name}' is not enabled in this runtime.`,
          }),
          type: 'function_call_output',
        });
        continue;
      }

      let args: unknown = {};
      try {
        args = item.arguments ? JSON.parse(item.arguments) : {};
      } catch {
        outputs.push({
          call_id: item.call_id,
          output: JSON.stringify({
            ok: false,
            error: `Tool '${item.name}' received invalid JSON arguments.`,
          }),
          type: 'function_call_output',
        });
        continue;
      }

      try {
        const result = await tool.execute(args);
        mergeEffectSummary(effectSummary, result.effectSummaryPatch);
        deferredDirectives.push(...(result.deferredDirectives ?? []));
        outputs.push({
          call_id: item.call_id,
          output: JSON.stringify({
            ok: true,
            result: result.outputText,
          }),
          type: 'function_call_output',
        });
      } catch (error) {
        outputs.push({
          call_id: item.call_id,
          output: JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : 'Tool execution failed.',
          }),
          type: 'function_call_output',
        });
      }
    }

    const continuationRequest: ResponseCreateParamsNonStreaming = {
      input: outputs,
      instructions: options.turn.prompt.instructions,
      metadata: {
        agentId: options.turn.agentId,
        headTurnId: options.turn.headTurnId,
      },
      model: options.turn.model || options.defaultDeploymentName,
      parallel_tool_calls: false,
      previous_response_id: response.id,
      safety_identifier: options.turn.agentId,
      tools: [
        ...buildFunctionToolDefinitions(options.turn.enabledTools),
          ...(options.turn.webSearchEnabled ? [buildWebSearchTool()] : []),
      ],
      truncation: 'auto',
    };

    response = await options.openAIClient.responses.create(continuationRequest);
    usage = mergeUsage(usage, extractUsage(response, 'head-turn'));
  }

  throw new DependencyUnavailableError(
    `Head runtime exceeded ${MAX_FUNCTION_TOOL_ROUNDS} function-tool rounds.`,
  );
}

export function createLiveHeadRuntimeAdapter(options: {
  defaultDeploymentName: string;
  projectEndpoint: string;
}): HeadRuntimeAdapter {
  const projectClient = new AIProjectClient(
    options.projectEndpoint,
    new DefaultAzureCredential(),
  );
  const openAIClient = projectClient.getOpenAIClient();

  return {
    async cancelTurn(input): Promise<void> {
      await openAIClient.responses.cancel(input.providerRunId);
    },

    async executeTurn(input: PreparedHeadTurnInput): Promise<FoundryHeadTurnResult> {
      const conversation =
        input.conversationCursor ??
        (
          await openAIClient.conversations.create({
            metadata: {
              agentId: input.agentId,
              headTurnId: input.headTurnId,
            },
          })
        ).id;

      const initialRequest: ResponseCreateParamsNonStreaming = {
        conversation,
        input: buildInputItems(input),
        instructions: input.prompt.instructions,
        metadata: {
          agentId: input.agentId,
          headTurnId: input.headTurnId,
        },
        model: input.model || options.defaultDeploymentName,
        parallel_tool_calls: false,
        safety_identifier: input.agentId,
        tools: [
          ...buildFunctionToolDefinitions(input.enabledTools),
          ...(input.webSearchEnabled ? [buildWebSearchTool()] : []),
        ],
        truncation: 'auto',
      };
      const initialResponse = await openAIClient.responses.create(initialRequest);

      if (initialResponse.error) {
        throw new DependencyUnavailableError(initialResponse.error.message ?? 'Foundry response failed.');
      }

      const {
        deferredDirectives,
        effectSummary,
        finalResponse,
        hadFunctionCalls,
        usage,
      } = await resolveFunctionCalls({
        defaultDeploymentName: options.defaultDeploymentName,
        openAIClient,
        response: initialResponse,
        tools: input.enabledTools,
        turn: input,
      });

      if (finalResponse.error) {
        throw new DependencyUnavailableError(finalResponse.error.message ?? 'Foundry response failed.');
      }

      const assistantText = finalResponse.output_text.trim() || null;

      return {
        assistantText,
        completionKind: toCompletionKind({
          assistantText,
          hadFunctionCalls,
        }),
        conversationCursor: finalResponse.conversation?.id ?? conversation,
        deferredDirectives,
        effectSummary,
        providerConversationId: finalResponse.conversation?.id ?? conversation,
        providerRunId: finalResponse.id,
        usage,
      };
    },
  };
}

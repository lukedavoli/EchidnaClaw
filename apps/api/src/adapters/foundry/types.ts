import type { CorrelationMetadata, HeadEffectSummary, HeadTurnCompletionKind } from '@echidna-claw/contracts';
import type { HeadPromptAssembly } from '@echidna-claw/prompting';

export interface HeadToolExecutionResult {
  effectSummaryPatch?: Partial<HeadEffectSummary>;
  outputText: string;
}

export interface PreparedHeadTool {
  description: string;
  execute(args: unknown): Promise<HeadToolExecutionResult>;
  inputSchema: Record<string, unknown> | null;
  name: string;
}

export interface PreparedHeadTurnInput {
  agentId: string;
  capabilitySummary?: string | null;
  conversationCursor: string | null;
  correlation: CorrelationMetadata;
  enabledTools: PreparedHeadTool[];
  headTurnId: string;
  model: string;
  modelInput: Array<{
    role: 'developer' | 'system' | 'user';
    text: string;
  }>;
  prompt: HeadPromptAssembly;
  webSearchEnabled: boolean;
}

export interface FoundryHeadTurnResult {
  assistantText: string | null;
  completionKind: HeadTurnCompletionKind;
  conversationCursor: string | null;
  effectSummary: HeadEffectSummary;
  providerConversationId: string | null;
  providerRunId: string | null;
}

export interface CancelFoundryTurnInput {
  providerRunId: string;
}

export interface HeadRuntimeAdapter {
  executeTurn(input: PreparedHeadTurnInput): Promise<FoundryHeadTurnResult>;
  cancelTurn(input: CancelFoundryTurnInput): Promise<void>;
}

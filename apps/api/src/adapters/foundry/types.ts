import type { CorrelationMetadata, HeadEffectSummary, HeadTurnCompletionKind } from '@echidna-claw/contracts';
import type { HeadPromptAssembly } from '@echidna-claw/prompting';

export type NormalizedProviderUsage = {
  analyticsGroup: string | null;
  provider: 'azure-foundry';
  providerOperationId: string | null;
  tokens: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number | null;
    toolInputTokens: number | null;
    toolOutputTokens: number | null;
  };
};

export type MemoryScopeBinding = {
  provider: 'telegram';
  scopeKey: string;
  storeName: string;
};

export type MemorySearchInputItem = {
  role: 'assistant' | 'developer' | 'user';
  text: string;
};

export type RetrievedMemory = {
  id: string;
  kind: 'user_profile' | 'chat_summary';
  text: string;
};

export type MemorySearchResult = {
  memories: RetrievedMemory[];
  searchId: string | null;
};

export type MemoryWriteCandidate = {
  category:
    | 'preference'
    | 'standing_instruction'
    | 'durable_fact'
    | 'recurring_pattern'
    | 'agent_guidance';
  text: string;
};

export type DeferredHeadDirective =
  | {
      kind: 'memory_write';
      candidate: MemoryWriteCandidate;
    };

export interface MemoryStoreAdapter {
  ensureStore(binding: MemoryScopeBinding): Promise<void>;
  search(input: {
    binding: MemoryScopeBinding;
    items: MemorySearchInputItem[];
    maxMemories?: number | undefined;
    previousSearchId?: string | null | undefined;
  }): Promise<MemorySearchResult>;
  commitWrites(input: {
    binding: MemoryScopeBinding;
    candidates: MemoryWriteCandidate[];
    previousUpdateId?: string | null | undefined;
  }): Promise<{ updateIds: string[] }>;
}

export interface HeadToolExecutionResult {
  deferredDirectives?: DeferredHeadDirective[];
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
  model?: string;
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
  deferredDirectives: DeferredHeadDirective[];
  effectSummary: HeadEffectSummary;
  providerConversationId: string | null;
  providerRunId: string | null;
  usage: NormalizedProviderUsage | null;
}

export interface CancelFoundryTurnInput {
  providerRunId: string;
}

export interface HeadRuntimeAdapter {
  executeTurn(input: PreparedHeadTurnInput): Promise<FoundryHeadTurnResult>;
  cancelTurn(input: CancelFoundryTurnInput): Promise<void>;
}

export interface WorkingContextSummaryInput {
  agentId: string;
  agentName: string;
  assistantReplyText: string | null;
  currentObjective: string | null;
  latestHandsStatus: string | null;
  openQuestions: string[];
  openTaskIds: string[];
  pendingApprovalIds: string[];
  previousSummary: string;
  timeZone: string;
  triggerKind: 'trusted_messages' | 'due_task';
  trustedMessages: Array<{
    id: string;
    sequence: number;
    text: string;
  }>;
}

export interface WorkingContextSummaryResult {
  currentObjective: string | null;
  latestHandsStatus: string | null;
  openQuestions: string[];
  summary: string;
  usage: NormalizedProviderUsage | null;
}

export interface WorkingContextSummarizerAdapter {
  summarize(input: WorkingContextSummaryInput): Promise<WorkingContextSummaryResult>;
}

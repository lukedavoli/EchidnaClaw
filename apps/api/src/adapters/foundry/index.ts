import type { ApiRuntimeConfig } from '../../config/api-runtime-config.js';
import { createLiveHeadRuntimeAdapter } from './live-head-runtime-adapter.js';
import { createLiveMemoryStoreAdapter } from './live-memory-store-adapter.js';
import { createLiveWorkingContextSummarizerAdapter } from './live-working-context-summarizer-adapter.js';
import { createLocalHeadRuntimeAdapter } from './local-head-runtime-adapter.js';
import { createLocalMemoryStoreAdapter } from './local-memory-store-adapter.js';
import { createLocalWorkingContextSummarizerAdapter } from './local-working-context-summarizer-adapter.js';
import type {
  CancelFoundryTurnInput,
  DeferredHeadDirective,
  FoundryHeadTurnResult,
  HeadRuntimeAdapter,
  MemoryScopeBinding,
  MemorySearchInputItem,
  MemorySearchResult,
  MemoryStoreAdapter,
  MemoryWriteCandidate,
  PreparedHeadTool,
  PreparedHeadTurnInput,
  RetrievedMemory,
  WorkingContextSummarizerAdapter,
  WorkingContextSummaryInput,
  WorkingContextSummaryResult,
} from './types.js';

export type {
  CancelFoundryTurnInput,
  DeferredHeadDirective,
  FoundryHeadTurnResult,
  HeadRuntimeAdapter,
  MemoryScopeBinding,
  MemorySearchInputItem,
  MemorySearchResult,
  MemoryStoreAdapter,
  MemoryWriteCandidate,
  PreparedHeadTool,
  PreparedHeadTurnInput,
  RetrievedMemory,
  WorkingContextSummarizerAdapter,
  WorkingContextSummaryInput,
  WorkingContextSummaryResult,
};

export interface FoundryAdapters {
  headRuntime: HeadRuntimeAdapter;
  memoryStore: MemoryStoreAdapter;
  workingContextSummarizer: WorkingContextSummarizerAdapter;
}

export function createFoundryAdapters(config: ApiRuntimeConfig): {
  adapters: FoundryAdapters;
  health: {
    description: string;
    mode: 'stubbed' | 'configured_live';
    ready: true;
  };
} {
  const headRuntime =
    config.runtimeMode === 'local-minimal'
      ? createLocalHeadRuntimeAdapter()
      : createLiveHeadRuntimeAdapter({
          defaultDeploymentName: config.foundry.defaultDeploymentName,
          projectEndpoint: config.sharedCloud!.foundry.projectEndpoint,
        });
  const workingContextSummarizer =
    config.runtimeMode === 'local-minimal'
      ? createLocalWorkingContextSummarizerAdapter()
      : createLiveWorkingContextSummarizerAdapter({
          defaultDeploymentName: config.foundry.defaultDeploymentName,
          projectEndpoint: config.sharedCloud!.foundry.projectEndpoint,
        });
  const memoryStore =
    config.runtimeMode === 'local-minimal'
      ? createLocalMemoryStoreAdapter()
      : createLiveMemoryStoreAdapter({
          chatModelDeploymentName: config.foundry.memoryChatDeploymentName,
          embeddingModelDeploymentName: config.foundry.memoryEmbeddingDeploymentName,
          projectEndpoint: config.sharedCloud!.foundry.projectEndpoint,
        });

  return {
    adapters: {
      headRuntime,
      memoryStore,
      workingContextSummarizer,
    },
    health: {
      description:
        config.runtimeMode === 'local-minimal'
          ? 'Stubbed Foundry wrappers provide deterministic local Head runtime behavior.'
          : 'Foundry adapters are configured against the shared Azure AI Foundry project.',
      mode: config.runtimeMode === 'local-minimal' ? 'stubbed' : 'configured_live',
      ready: true,
    },
  };
}

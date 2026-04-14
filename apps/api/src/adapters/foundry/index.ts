import type { ApiRuntimeConfig } from '../../config/api-runtime-config.js';
import { NotImplementedYetError } from '../../http/errors.js';
import { createLiveHeadRuntimeAdapter } from './live-head-runtime-adapter.js';
import { createLiveWorkingContextSummarizerAdapter } from './live-working-context-summarizer-adapter.js';
import { createLocalHeadRuntimeAdapter } from './local-head-runtime-adapter.js';
import { createLocalWorkingContextSummarizerAdapter } from './local-working-context-summarizer-adapter.js';
import type {
  CancelFoundryTurnInput,
  FoundryHeadTurnResult,
  HeadRuntimeAdapter,
  PreparedHeadTool,
  PreparedHeadTurnInput,
  WorkingContextSummarizerAdapter,
  WorkingContextSummaryInput,
  WorkingContextSummaryResult,
} from './types.js';

export type {
  CancelFoundryTurnInput,
  FoundryHeadTurnResult,
  HeadRuntimeAdapter,
  PreparedHeadTool,
  PreparedHeadTurnInput,
  WorkingContextSummarizerAdapter,
  WorkingContextSummaryInput,
  WorkingContextSummaryResult,
};

export interface MemoryStoreAdapter {
  appendTurnMemory(headTurnId: string): Promise<void>;
}

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

  return {
    adapters: {
      headRuntime,
      memoryStore: {
        async appendTurnMemory(_headTurnId: string): Promise<void> {
          void _headTurnId;
          throw new NotImplementedYetError(
            'Foundry memory-store integration is reserved for Step 17.',
          );
        },
      },
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

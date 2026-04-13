import type { HeadStartTurnRequest, HeadSupersedeTurnRequest, HeadTurn } from '@echidna-claw/contracts';

import { NotImplementedYetError } from '../../http/errors.js';

export interface HeadRuntimeAdapter {
  startTurn(input: HeadStartTurnRequest): Promise<HeadTurn>;
  supersedeTurn(input: HeadSupersedeTurnRequest): Promise<HeadTurn>;
}

export interface MemoryStoreAdapter {
  appendTurnMemory(headTurnId: string): Promise<void>;
}

export interface FoundryAdapters {
  headRuntime: HeadRuntimeAdapter;
  memoryStore: MemoryStoreAdapter;
}

export function createFoundryAdapters(mode: 'stubbed' | 'configured_placeholder'): {
  adapters: FoundryAdapters;
  health: {
    description: string;
    mode: 'stubbed' | 'configured_placeholder';
    ready: true;
  };
} {
  return {
    adapters: {
      headRuntime: {
        async startTurn(input: HeadStartTurnRequest): Promise<HeadTurn> {
          void input;
          throw new NotImplementedYetError(
            'Head prompt-agent operations are reserved for Step 10.',
          );
        },
        async supersedeTurn(input: HeadSupersedeTurnRequest): Promise<HeadTurn> {
          void input;
          throw new NotImplementedYetError(
            'Head turn supersession is reserved for Step 10.',
          );
        },
      },
      memoryStore: {
        async appendTurnMemory(headTurnId: string): Promise<void> {
          void headTurnId;
          throw new NotImplementedYetError(
            'Foundry memory-store integration is reserved for Step 17.',
          );
        },
      },
    },
    health: {
      description:
        mode === 'stubbed'
          ? 'Stubbed Foundry wrappers keep local-minimal startup bootable.'
          : 'Foundry config is present; the wrappers are reserved for later implementation steps.',
      mode,
      ready: true,
    },
  };
}

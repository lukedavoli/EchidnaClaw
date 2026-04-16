import type { ApiRuntimeConfig } from '../config/api-runtime-config.js';
import type { Logger } from '@echidna-claw/observability';
import { createArtifactStorageAdapter, type ArtifactStorageAdapter } from './blob/index.js';
import { createFoundryAdapters, type FoundryAdapters } from './foundry/index.js';
import {
  createRuntimeAdapters,
  type HandsJobTriggerAdapter,
  type SchedulerRuntimeAdapter,
  type TaskQueueGateway,
} from './jobs/index.js';
import { createKeyVaultAdapters, type KeyVaultAdapters } from './key-vault/index.js';
import { createRepositoryBundle, type RepositoryBundle } from './repositories/index.js';
import { createSandboxRuntimeAdapter, type SandboxRuntimeAdapter } from './sandbox/index.js';
import {
  createTelegramTransportAdapter,
  type TelegramBotApiAdapter,
} from './telegram/index.js';

export type AdapterMode = 'configured_live' | 'configured_placeholder' | 'in_memory' | 'stubbed';

export type AdapterHealth = {
  description: string;
  mode: AdapterMode;
  ready: boolean;
};

export type ExternalAdapters = {
  artifactStorage: ArtifactStorageAdapter;
  foundry: FoundryAdapters;
  handsJobs: HandsJobTriggerAdapter;
  keyVault: KeyVaultAdapters;
  repositories: RepositoryBundle;
  sandboxRuntime: SandboxRuntimeAdapter;
  schedulerRuntime: SchedulerRuntimeAdapter;
  telegramBotApi: TelegramBotApiAdapter;
};

export function createExternalAdapters(config: ApiRuntimeConfig): {
  adapters: ExternalAdapters;
  health: Record<string, AdapterHealth>;
};
export function createExternalAdapters(
  config: ApiRuntimeConfig,
  options: {
    getTaskQueueService?: () => {
      enqueueTask: TaskQueueGateway['enqueueTask'];
    };
    runtimeLogger?: Logger;
  },
): {
  adapters: ExternalAdapters;
  health: Record<string, AdapterHealth>;
};
export function createExternalAdapters(
  config: ApiRuntimeConfig,
  options?: {
    getTaskQueueService?: () => {
      enqueueTask: TaskQueueGateway['enqueueTask'];
    };
    runtimeLogger?: Logger;
  },
): {
  adapters: ExternalAdapters;
  health: Record<string, AdapterHealth>;
} {
  const placeholderMode: 'configured_placeholder' | 'stubbed' =
    config.runtimeMode === 'local-minimal' ? 'stubbed' : 'configured_placeholder';
  const foundry = createFoundryAdapters(config);
  const repositories = createRepositoryBundle(config);
  const keyVault = createKeyVaultAdapters(placeholderMode);
  const artifactStorage = createArtifactStorageAdapter(placeholderMode);
  const sandbox = createSandboxRuntimeAdapter(config);
  const telegram = createTelegramTransportAdapter(config);
  const runtime = createRuntimeAdapters({
    config,
    getTaskQueueService:
      options?.getTaskQueueService ??
      (() => {
        throw new Error('Task queue service is not bound yet.');
      }),
    logger:
      options?.runtimeLogger ??
      {
        child() {
          return this;
        },
        debug() {},
        error() {},
        info() {},
        warn() {},
      },
    repositories: repositories.repositories,
    sandboxRuntime: sandbox.adapter,
  });

  return {
    adapters: {
      artifactStorage: artifactStorage.adapter,
      foundry: foundry.adapters,
      handsJobs: runtime.runtime.handsJobs,
      keyVault: keyVault.adapters,
      repositories: repositories.repositories,
      sandboxRuntime: sandbox.adapter,
      schedulerRuntime: runtime.runtime.schedulerRuntime,
      telegramBotApi: telegram.adapter,
    },
    health: {
      artifactStorage: artifactStorage.health,
      foundry: foundry.health,
      handsJobs: runtime.health.handsJobs,
      keyVault: keyVault.health,
      repositories: repositories.health,
      sandboxRuntime: sandbox.health,
      schedulerRuntime: runtime.health.schedulerRuntime,
      telegramBotApi: telegram.health,
    },
  };
}

import type { ApiRuntimeConfig } from '../config/api-runtime-config.js';
import { createArtifactStorageAdapter, type ArtifactStorageAdapter } from './blob/index.js';
import { createFoundryAdapters, type FoundryAdapters } from './foundry/index.js';
import {
  createRuntimeAdapters,
  type HandsJobTriggerAdapter,
  type SandboxRuntimeAdapter,
  type SchedulerRuntimeAdapter,
} from './jobs/index.js';
import { createKeyVaultAdapters, type KeyVaultAdapters } from './key-vault/index.js';
import { createRepositoryBundle, type RepositoryBundle } from './repositories/index.js';
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
} {
  const placeholderMode: 'configured_placeholder' | 'stubbed' =
    config.runtimeMode === 'local-minimal' ? 'stubbed' : 'configured_placeholder';
  const foundry = createFoundryAdapters(config);
  const repositories = createRepositoryBundle(config);
  const keyVault = createKeyVaultAdapters(placeholderMode);
  const artifactStorage = createArtifactStorageAdapter(placeholderMode);
  const runtime = createRuntimeAdapters(placeholderMode);
  const telegram = createTelegramTransportAdapter(config);

  return {
    adapters: {
      artifactStorage: artifactStorage.adapter,
      foundry: foundry.adapters,
      handsJobs: runtime.runtime.handsJobs,
      keyVault: keyVault.adapters,
      repositories: repositories.repositories,
      sandboxRuntime: runtime.runtime.sandboxRuntime,
      schedulerRuntime: runtime.runtime.schedulerRuntime,
      telegramBotApi: telegram.adapter,
    },
    health: {
      artifactStorage: artifactStorage.health,
      foundry: foundry.health,
      handsJobs: runtime.health.handsJobs,
      keyVault: keyVault.health,
      repositories: repositories.health,
      sandboxRuntime: runtime.health.sandboxRuntime,
      schedulerRuntime: runtime.health.schedulerRuntime,
      telegramBotApi: telegram.health,
    },
  };
}

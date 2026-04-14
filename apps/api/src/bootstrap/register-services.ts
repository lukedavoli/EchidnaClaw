import { loadRepositoryConfig } from '@echidna-claw/config';
import type { LoggerFactory } from '@echidna-claw/observability';

import { createExternalAdapters } from '../adapters/index.js';
import type { ApiRuntimeConfig } from '../config/api-runtime-config.js';
import { createWebControlPlaneService } from '../services/admin/web-control-plane-service.js';
import {
  createApprovalActionDispatcher,
  createTrustedChannelIngressDispatcher,
} from '../services/channel/dispatchers.js';
import { createOutboundMessagingService } from '../services/channel/outbound-messaging-service.js';
import { createTelegramIngressService } from '../services/channel/telegram-ingress-service.js';
import { createHandsRuntimeService } from '../services/runtime/hands-runtime-service.js';
import { createHeadRuntimeService } from '../services/runtime/head-runtime-service.js';
import { createSandboxRuntimeService } from '../services/runtime/sandbox-runtime-service.js';
import { createSchedulerRuntimeService } from '../services/runtime/scheduler-runtime-service.js';
import { createTaskQueueService } from '../services/runtime/task-queue-service.js';
import type { ApiDependencies } from './app-types.js';

export function registerServices(options: {
  config: ApiRuntimeConfig;
  loggerFactory: LoggerFactory;
}): ApiDependencies {
  const adapters = createExternalAdapters(options.config);
  const appLogger = options.loggerFactory.createLogger({ component: 'api_app' });
  const repositoryConfig = loadRepositoryConfig();
  const approvalCallbackService = createApprovalActionDispatcher({
    logger: options.loggerFactory.createLogger({ service: 'approval_callback' }),
  });
  const outboundMessagingService = createOutboundMessagingService({
    logger: options.loggerFactory.createLogger({ service: 'outbound_messaging' }),
    repositories: adapters.adapters.repositories,
    telegramBotApi: adapters.adapters.telegramBotApi,
  });
  const trustedChannelIngressDispatcher = createTrustedChannelIngressDispatcher({
    logger: options.loggerFactory.createLogger({ service: 'trusted_channel_ingress' }),
  });
  const taskQueueService = createTaskQueueService({
    handsJobs: adapters.adapters.handsJobs,
    logger: options.loggerFactory.createLogger({ service: 'task_queue' }),
    repositories: adapters.adapters.repositories,
  });

  return {
    adapters: adapters.adapters,
    appLogger,
    config: options.config,
    loggerFactory: options.loggerFactory,
    readiness: {
      dependencies: adapters.health,
      ready: Object.values(adapters.health).every((dependency) => dependency.ready),
      runtimeMode: options.config.runtimeMode,
    },
    repositoryConfig,
    services: {
      approvalCallbackService,
      handsRuntimeService: createHandsRuntimeService({
        handsJobs: adapters.adapters.handsJobs,
        logger: options.loggerFactory.createLogger({ service: 'hands_runtime' }),
      }),
      outboundMessagingService,
      headRuntimeService: createHeadRuntimeService({
        config: options.config,
        headRuntime: adapters.adapters.foundry.headRuntime,
        logger: options.loggerFactory.createLogger({ service: 'head_runtime' }),
        repositories: adapters.adapters.repositories,
        repositoryConfig,
        taskQueueService,
      }),
      sandboxRuntimeService: createSandboxRuntimeService({
        logger: options.loggerFactory.createLogger({ service: 'sandbox_runtime' }),
        sandboxRuntime: adapters.adapters.sandboxRuntime,
      }),
      schedulerRuntimeService: createSchedulerRuntimeService({
        logger: options.loggerFactory.createLogger({ service: 'scheduler_runtime' }),
        schedulerRuntime: adapters.adapters.schedulerRuntime,
      }),
      taskQueueService,
      telegramIngressService: createTelegramIngressService({
        approvalCallbackService,
        logger: options.loggerFactory.createLogger({ service: 'telegram_ingress' }),
        repositories: adapters.adapters.repositories,
        telegramBotApi: adapters.adapters.telegramBotApi,
        trustedChannelIngressDispatcher,
      }),
      webControlPlaneService: createWebControlPlaneService({
        logger: options.loggerFactory.createLogger({ service: 'web_control_plane' }),
        repositories: adapters.adapters.repositories,
        repositoryConfig,
      }),
    },
  };
}

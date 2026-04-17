import { loadRepositoryConfig } from '@echidna-claw/config';
import type { LoggerFactory } from '@echidna-claw/observability';

import { createExternalAdapters } from '../adapters/index.js';
import type { ApiRuntimeConfig } from '../config/api-runtime-config.js';
import { createAnalyticsQueryService } from '../services/admin/analytics-query-service.js';
import { createWebControlPlaneService } from '../services/admin/web-control-plane-service.js';
import {
  createApprovalActionDispatcher,
  createTrustedChannelIngressDispatcher,
} from '../services/channel/dispatchers.js';
import { createOutboundMessagingService } from '../services/channel/outbound-messaging-service.js';
import { createTelegramIngressService } from '../services/channel/telegram-ingress-service.js';
import { createTelegramProvisioningService } from '../services/channel/telegram-provisioning-service.js';
import { createApprovalLifecycleService } from '../services/runtime/approval-lifecycle-service.js';
import { createAuditHistoryService } from '../services/runtime/audit-history-service.js';
import { createCredentialLifecycleService } from '../services/runtime/credential-lifecycle-service.js';
import { createConversationMemoryService } from '../services/runtime/conversation-memory-service.js';
import { createHandsRuntimeService } from '../services/runtime/hands-runtime-service.js';
import { createHeadRuntimeService } from '../services/runtime/head-runtime-service.js';
import { createSandboxRuntimeService } from '../services/runtime/sandbox-runtime-service.js';
import { createScheduleMutationService } from '../services/runtime/schedule-mutation-service.js';
import { createSchedulerRuntimeService } from '../services/runtime/scheduler-runtime-service.js';
import { createTaskQueueService } from '../services/runtime/task-queue-service.js';
import { createUsageAccountingService } from '../services/runtime/usage-accounting-service.js';
import { createWorkingContextSummaryService } from '../services/runtime/working-context-summary-service.js';
import type { ApiDependencies } from './app-types.js';

export function registerServices(options: {
  config: ApiRuntimeConfig;
  loggerFactory: LoggerFactory;
}): ApiDependencies {
  let taskQueueServiceRef:
    | {
        enqueueTask: ApiDependencies['services']['taskQueueService']['enqueueTask'];
      }
    | null = null;
  const adapters = createExternalAdapters(options.config, {
    getTaskQueueService: () => {
      if (taskQueueServiceRef == null) {
        throw new Error('Task queue service has not been initialized yet.');
      }

      return taskQueueServiceRef;
    },
    runtimeLogger: options.loggerFactory.createLogger({ service: 'hands_runtime_dispatch' }),
  });
  const appLogger = options.loggerFactory.createLogger({ component: 'api_app' });
  const repositoryConfig = loadRepositoryConfig();
  const outboundMessagingService = createOutboundMessagingService({
    logger: options.loggerFactory.createLogger({ service: 'outbound_messaging' }),
    repositories: adapters.adapters.repositories,
    telegramBotApi: adapters.adapters.telegramBotApi,
  });
  const taskQueueService = createTaskQueueService({
    handsJobs: adapters.adapters.handsJobs,
    logger: options.loggerFactory.createLogger({ service: 'task_queue' }),
    repositories: adapters.adapters.repositories,
  });
  taskQueueServiceRef = taskQueueService;
  const handsRuntimeService = createHandsRuntimeService({
    handsJobs: adapters.adapters.handsJobs,
    logger: options.loggerFactory.createLogger({ service: 'hands_runtime' }),
    repositories: adapters.adapters.repositories,
    taskQueueService,
  });
  const auditHistoryService = createAuditHistoryService({
    logger: options.loggerFactory.createLogger({ service: 'audit_history' }),
    repositories: adapters.adapters.repositories,
    repositoryConfig,
  });
  const usageAccountingService = createUsageAccountingService({
    logger: options.loggerFactory.createLogger({ service: 'usage_accounting' }),
    repositories: adapters.adapters.repositories,
    repositoryConfig,
  });
  const analyticsQueryService = createAnalyticsQueryService({
    logger: options.loggerFactory.createLogger({ service: 'analytics_query' }),
    repositories: adapters.adapters.repositories,
    repositoryConfig,
  });
  const approvalLifecycleService = createApprovalLifecycleService({
    auditHistoryService,
    handsRuntimeService,
    logger: options.loggerFactory.createLogger({ service: 'approval_lifecycle' }),
    outboundMessagingService,
    repositories: adapters.adapters.repositories,
    repositoryConfig,
    taskQueueService,
  });
  const credentialLifecycleService = createCredentialLifecycleService({
    handsRuntimeService,
    logger: options.loggerFactory.createLogger({ service: 'credential_lifecycle' }),
    outboundMessagingService,
    repositories: adapters.adapters.repositories,
    repositoryConfig,
    taskQueueService,
  });
  const approvalCallbackService = createApprovalActionDispatcher({
    approvalLifecycleService,
    logger: options.loggerFactory.createLogger({ service: 'approval_callback' }),
  });
  const telegramProvisioningService = createTelegramProvisioningService({
    config: options.config,
    credentialLifecycleService,
    logger: options.loggerFactory.createLogger({ service: 'telegram_provisioning' }),
    repositories: adapters.adapters.repositories,
    telegramBotApi: adapters.adapters.telegramBotApi,
  });
  const workingContextSummaryService = createWorkingContextSummaryService({
    logger: options.loggerFactory.createLogger({ service: 'working_context_summary' }),
    summarizer: adapters.adapters.foundry.workingContextSummarizer,
  });
  const conversationMemoryService = createConversationMemoryService({
    logger: options.loggerFactory.createLogger({ service: 'conversation_memory' }),
    memoryStore: adapters.adapters.foundry.memoryStore,
    repositoryConfig,
  });
  const scheduleMutationService = createScheduleMutationService({
    repositories: adapters.adapters.repositories,
  });
  const headRuntimeService = createHeadRuntimeService({
    approvalLifecycleService,
    auditHistoryService,
    config: options.config,
    conversationMemoryService,
    credentialLifecycleService,
    headRuntime: adapters.adapters.foundry.headRuntime,
    logger: options.loggerFactory.createLogger({ service: 'head_runtime' }),
    repositories: adapters.adapters.repositories,
    repositoryConfig,
    scheduleMutationService,
    taskQueueService,
    usageAccountingService,
    workingContextSummaryService,
  });
  const trustedChannelIngressDispatcher = createTrustedChannelIngressDispatcher({
    config: options.config,
    headRuntimeService,
    logger: options.loggerFactory.createLogger({ service: 'trusted_channel_ingress' }),
    outboundMessagingService,
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
      handsRuntimeService,
      outboundMessagingService,
      headRuntimeService,
      sandboxRuntimeService: createSandboxRuntimeService({
        auditHistoryService,
        credentialLifecycleService,
        logger: options.loggerFactory.createLogger({ service: 'sandbox_runtime' }),
        repositories: adapters.adapters.repositories,
        repositoryConfig,
        sandboxRuntime: adapters.adapters.sandboxRuntime,
      }),
      schedulerRuntimeService: createSchedulerRuntimeService({
        auditHistoryService,
        headRuntimeService,
        logger: options.loggerFactory.createLogger({ service: 'scheduler_runtime' }),
        repositories: adapters.adapters.repositories,
      }),
      taskQueueService,
      telegramIngressService: createTelegramIngressService({
        approvalCallbackService,
        credentialLifecycleService,
        logger: options.loggerFactory.createLogger({ service: 'telegram_ingress' }),
        repositories: adapters.adapters.repositories,
        telegramBotApi: adapters.adapters.telegramBotApi,
        telegramProvisioningService,
        trustedChannelIngressDispatcher,
      }),
      telegramProvisioningService,
      webControlPlaneService: createWebControlPlaneService({
        analyticsQueryService,
        credentialLifecycleService,
        logger: options.loggerFactory.createLogger({ service: 'web_control_plane' }),
        repositories: adapters.adapters.repositories,
        repositoryConfig,
        telegramProvisioningService,
      }),
    },
  };
}

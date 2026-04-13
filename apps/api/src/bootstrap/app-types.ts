import 'fastify';

import type {
  HeadService,
  HandsService,
  RepositoryConfig,
  SandboxService,
  SchedulerService,
  WebControlPlaneService,
} from '@echidna-claw/contracts';
import type { Logger, LoggerFactory, RequestContext } from '@echidna-claw/observability';

import type { ExternalAdapters, AdapterHealth } from '../adapters/index.js';
import type { ApiRuntimeConfig } from '../config/api-runtime-config.js';
import type {
  ApprovalCallbackService,
  OutboundMessagingService,
  TelegramIngressService,
} from '../services/channel/contracts.js';

export type ApiServices = {
  approvalCallbackService: ApprovalCallbackService;
  handsRuntimeService: HandsService;
  headRuntimeService: HeadService;
  outboundMessagingService: OutboundMessagingService;
  sandboxRuntimeService: SandboxService;
  schedulerRuntimeService: SchedulerService;
  telegramIngressService: TelegramIngressService;
  webControlPlaneService: WebControlPlaneService;
};

export type ReadinessReport = {
  dependencies: Record<string, AdapterHealth>;
  ready: boolean;
  runtimeMode: ApiRuntimeConfig['runtimeMode'];
};

export type ApiDependencies = {
  adapters: ExternalAdapters;
  appLogger: Logger;
  config: ApiRuntimeConfig;
  loggerFactory: LoggerFactory;
  readiness: ReadinessReport;
  repositoryConfig: RepositoryConfig;
  services: ApiServices;
};

declare module 'fastify' {
  interface FastifyInstance {
    dependencies: ApiDependencies;
  }

  interface FastifyRequest {
    requestContext: RequestContext | null;
  }
}

export {};

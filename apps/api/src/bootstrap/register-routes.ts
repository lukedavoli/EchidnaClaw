import type { FastifyInstance } from 'fastify';

import {
  assertInternalRuntimeAuthorized,
  assertTelegramWebhookAuthorized,
} from '../http/protection.js';
import { registerAdminAgentRoutes } from '../http/routes/admin/agents.js';
import { registerAdminAnalyticsRoutes } from '../http/routes/admin/analytics.js';
import { registerAdminApprovalRoutes } from '../http/routes/admin/approvals.js';
import { registerHealthRoutes } from '../http/routes/health.js';
import { registerHeadRuntimeRoutes } from '../http/routes/internal/head.js';
import { registerHandsRuntimeRoutes } from '../http/routes/internal/hands.js';
import { registerSandboxRuntimeRoutes } from '../http/routes/internal/sandbox.js';
import { registerSchedulerRuntimeRoutes } from '../http/routes/internal/scheduler.js';
import { registerReadinessRoutes } from '../http/routes/readiness.js';
import { registerOutboundMessagingRoutes } from '../http/routes/telegram/outbound.js';
import { registerTelegramWebhookRoutes } from '../http/routes/telegram/webhook.js';

export function registerRoutes(app: FastifyInstance): void {
  registerHealthRoutes(app);
  registerReadinessRoutes(app);

  app.register(
    async (adminApp) => {
      registerAdminAgentRoutes(adminApp);
      registerAdminAnalyticsRoutes(adminApp);
      registerAdminApprovalRoutes(adminApp);
    },
    { prefix: '/api/admin' },
  );

  app.register(
    async (telegramApp) => {
      telegramApp.addHook('onRequest', async (request) => {
        assertTelegramWebhookAuthorized(request, telegramApp.dependencies.config);
      });

      registerTelegramWebhookRoutes(telegramApp);
    },
    { prefix: '/api/channels/telegram' },
  );

  app.register(
    async (outboundApp) => {
      outboundApp.addHook('onRequest', async (request) => {
        assertInternalRuntimeAuthorized(request, outboundApp.dependencies.config);
      });

      registerOutboundMessagingRoutes(outboundApp);
    },
    { prefix: '/api/internal/outbound-messages' },
  );

  app.register(
    async (runtimeApp) => {
      runtimeApp.addHook('onRequest', async (request) => {
        assertInternalRuntimeAuthorized(request, runtimeApp.dependencies.config);
      });

      registerHeadRuntimeRoutes(runtimeApp);
      registerHandsRuntimeRoutes(runtimeApp);
      registerSandboxRuntimeRoutes(runtimeApp);
      registerSchedulerRuntimeRoutes(runtimeApp);
    },
    { prefix: '/api/internal/runtime' },
  );
}

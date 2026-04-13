import Fastify, { type FastifyInstance } from 'fastify';

import { createLoggerFactory, type LogSink } from '@echidna-claw/observability';

import { loadApiRuntimeConfig, type ApiRuntimeConfig } from '../config/api-runtime-config.js';
import './app-types.js';
import { registerCorePlugins } from './register-core-plugins.js';
import { registerRoutes } from './register-routes.js';
import { registerServices } from './register-services.js';

export function buildApiServer(
  config: ApiRuntimeConfig = loadApiRuntimeConfig(),
  options: {
    logSink?: LogSink;
  } = {},
): FastifyInstance {
  const loggerFactoryOptions: {
    level: ApiRuntimeConfig['logLevel'];
    serviceName: ApiRuntimeConfig['serviceName'];
    sink?: LogSink;
  } = {
    level: config.logLevel,
    serviceName: config.serviceName,
  };

  if (options.logSink != null) {
    loggerFactoryOptions.sink = options.logSink;
  }

  const loggerFactory = createLoggerFactory(loggerFactoryOptions);
  const dependencies = registerServices({ config, loggerFactory });
  const app = Fastify({
    logger: false,
    trustProxy: config.observability.trustProxy,
  });

  app.decorate('dependencies', dependencies);

  registerCorePlugins(app);
  registerRoutes(app);

  return app;
}

import { loadHandsConfig, type HandsConfig } from '@echidna-claw/config';

export type HandsRuntime = {
  heartbeatIntervalMs: number;
  serviceName: 'hands';
  startupMessage: string;
};

export function createHandsRuntime(config: HandsConfig = loadHandsConfig()): HandsRuntime {
  return {
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    serviceName: config.serviceName,
    startupMessage: `[${config.serviceName}] ready in ${config.nodeEnv} mode`,
  };
}

import { loadHandsConfig, type HandsConfig } from '@echidna-claw/config';

export type HandsRuntime = {
  heartbeatIntervalMs: number;
  livenessFile: string;
  runtimeMode: HandsConfig['runtimeMode'];
  serviceName: 'hands';
  startupMessage: string;
};

export function createHandsRuntime(config: HandsConfig = loadHandsConfig()): HandsRuntime {
  return {
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    livenessFile: config.livenessFile,
    runtimeMode: config.runtimeMode,
    serviceName: config.serviceName,
    startupMessage: `[${config.serviceName}] ready in ${config.nodeEnv} (${config.runtimeMode}) mode`,
  };
}

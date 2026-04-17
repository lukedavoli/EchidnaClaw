export type TelemetryBootstrapResult = {
  connectionString: string | null;
  enabled: boolean;
  serviceName: string;
};

const initializedServices = new Set<string>();

export function initializeTelemetry(options: {
  connectionString?: string | null;
  runtimeMode?: string;
  serviceName: string;
}): TelemetryBootstrapResult {
  const connectionString = options.connectionString?.trim() || null;

  if (!connectionString || options.runtimeMode === 'local-minimal') {
    return {
      connectionString: null,
      enabled: false,
      serviceName: options.serviceName,
    };
  }

  initializedServices.add(options.serviceName);

  return {
    connectionString,
    enabled: true,
    serviceName: options.serviceName,
  };
}

export function isTelemetryInitialized(serviceName: string): boolean {
  return initializedServices.has(serviceName);
}

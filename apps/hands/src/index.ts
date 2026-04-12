import { loadHandsConfig } from '@echidna-claw/config';

import { createHandsRuntime } from './runtime.js';

const config = loadHandsConfig();
const runtime = createHandsRuntime(config);

console.log(runtime.startupMessage);
console.log(`[${runtime.serviceName}] heartbeat interval ${runtime.heartbeatIntervalMs}ms`);

let heartbeatCount = 0;

setInterval(() => {
  heartbeatCount += 1;
  console.log(`[${runtime.serviceName}] heartbeat ${heartbeatCount}`);
}, runtime.heartbeatIntervalMs);

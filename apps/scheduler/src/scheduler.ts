import { loadSchedulerConfig } from '@echidna-claw/config';
import { createLoggerFactory } from '@echidna-claw/observability';

import { processDueWorkRun } from './runtime.js';

async function main(): Promise<void> {
  const config = loadSchedulerConfig();
  const logger = createLoggerFactory({
    level: config.logLevel,
    serviceName: 'scheduler',
  }).createLogger({ component: 'scheduler_job' });
  const result = await processDueWorkRun(config);

  logger.info('scheduler_job.completed', result);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown scheduler runtime failure.';
  console.error(message);
  process.exitCode = 1;
});

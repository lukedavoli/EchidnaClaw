import { spawnSync } from 'node:child_process';
import process from 'node:process';

const targets = [
  ['apps/api/Dockerfile', process.env.ECHIDNA_IMAGE_REPOSITORY_API?.trim() || 'echidna-claw/api'],
  [
    'apps/hands/Dockerfile',
    process.env.ECHIDNA_IMAGE_REPOSITORY_HANDS?.trim() || 'echidna-claw/hands',
  ],
  [
    'apps/sandbox/Dockerfile',
    process.env.ECHIDNA_IMAGE_REPOSITORY_SANDBOX?.trim() || 'echidna-claw/sandbox',
  ],
  [
    'apps/scheduler/Dockerfile',
    process.env.ECHIDNA_IMAGE_REPOSITORY_SCHEDULER?.trim() || 'echidna-claw/scheduler',
  ],
  ['apps/web/Dockerfile', process.env.ECHIDNA_IMAGE_REPOSITORY_WEB?.trim() || 'echidna-claw/web'],
];
const imageTag = process.env.ECHIDNA_IMAGE_TAG?.trim() || 'local';
const registryLoginServer = process.env.ECHIDNA_CONTAINER_REGISTRY_LOGIN_SERVER?.trim();
const pushImages = process.argv.includes('--push');
const dryRun = process.argv.includes('--dry-run');
const buildArgs = [
  ['VITE_API_BASE_URL', process.env.VITE_API_BASE_URL?.trim()],
  ['VITE_APP_BASE_URL', process.env.VITE_APP_BASE_URL?.trim()],
  ['VITE_APP_TITLE', process.env.VITE_APP_TITLE?.trim()],
  ['VITE_RUNTIME_MODE', process.env.VITE_RUNTIME_MODE?.trim()],
].flatMap(([name, value]) => (value ? ['--build-arg', `${name}=${value}`] : []));

if (pushImages && !registryLoginServer) {
  console.error(
    'ECHIDNA_CONTAINER_REGISTRY_LOGIN_SERVER must be set before running docker-build.mjs --push',
  );
  process.exit(1);
}

function resolveImageReference(repository) {
  return registryLoginServer
    ? `${registryLoginServer}/${repository}:${imageTag}`
    : `${repository}:${imageTag}`;
}

if (dryRun) {
  for (const [dockerfile, repository] of targets) {
    console.log(`${dockerfile} -> ${resolveImageReference(repository)}`);
  }

  process.exit(0);
}

for (const [dockerfile, repository] of targets) {
  const imageReference = resolveImageReference(repository);
  const result = spawnSync(
    'docker',
    ['build', '-f', dockerfile, '-t', imageReference, ...buildArgs, '.'],
    {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  if (!pushImages) {
    continue;
  }

  const pushResult = spawnSync('docker', ['push', imageReference], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (pushResult.status !== 0) {
    process.exit(pushResult.status ?? 1);
  }
}

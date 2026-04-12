import { spawnSync } from 'node:child_process';

const targets = [
  ['apps/api/Dockerfile', 'echidna-claw-api'],
  ['apps/hands/Dockerfile', 'echidna-claw-hands'],
  ['apps/sandbox/Dockerfile', 'echidna-claw-sandbox'],
  ['apps/web/Dockerfile', 'echidna-claw-web'],
];

for (const [dockerfile, tag] of targets) {
  const result = spawnSync('docker', ['build', '-f', dockerfile, '-t', `${tag}:step1`, '.'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

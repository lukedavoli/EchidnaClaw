import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { repositoryConfigSchema, type RepositoryConfig } from '@echidna-claw/contracts';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(packageRoot, '../../..');

export const defaultRepositoryConfigPath = resolve(repositoryRoot, 'config', 'repository.v1.json');

export function loadRepositoryConfig(path = defaultRepositoryConfigPath): RepositoryConfig {
  if (!existsSync(path)) {
    throw new Error(`Repository config file not found: ${path}`);
  }

  const contents = readFileSync(path, 'utf8');
  return repositoryConfigSchema.parse(JSON.parse(contents) as unknown);
}

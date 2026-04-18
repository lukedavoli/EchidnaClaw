import type { PackageAllowlist, SandboxPolicy } from '@echidna-claw/contracts';
import { describe, expect, it } from 'vitest';

import { validateSandboxCommand } from '../src/index.js';

const policy: SandboxPolicy = {
  allowCommands: ['node', 'pnpm'],
  allowFilesystemWriteUnder: ['/work', '/home'],
  allowOutboundHosts: ['registry.npmjs.org'],
  blockFilesystemPaths: ['/work/.git'],
  blockOutboundHosts: ['169.254.169.254'],
  description: 'Test policy.',
  name: 'standard',
  resourceLimits: {
    defaultTimeoutMs: 10000,
    maxCpuSeconds: 30,
    maxMemoryMb: 1024,
    maxOutputBytes: 32768,
    maxTimeoutMs: 60000,
  },
};

const allowlist: PackageAllowlist = {
  name: 'default-runtime-pnpm',
  packageManager: 'pnpm',
  packages: ['zod'],
};

describe('validateSandboxCommand', () => {
  it('accepts allowlisted package installs under the configured package manager', () => {
    const result = validateSandboxCommand({
      allowlist,
      command: 'pnpm add zod',
      policy,
    });

    expect(result).toEqual({
      allowed: true,
      commandName: 'pnpm',
      installRequest: {
        packageManager: 'pnpm',
        packages: ['zod'],
      },
      requestedHosts: [],
      requestedPaths: [],
      tokens: ['pnpm', 'add', 'zod'],
    });
  });
});

import { describe, expect, it } from 'vitest';

import type { RepositoryConfig } from '../../contracts/src/index.js';
import {
  clampSandboxTimeoutMs,
  createDeterministicSandboxSessionId,
  resolveSandboxPackageAllowlist,
  resolveSandboxPath,
  resolveSandboxPolicy,
  validateSandboxCommand,
} from '../src/index.js';

const repositoryConfig: RepositoryConfig = {
  version: '1',
  models: {
    defaultModel: 'gpt-5.4-mini',
    pricing: [
      {
        model: 'gpt-5.4-mini',
        provider: 'azure-foundry',
        effectiveAt: '2026-04-12T00:00:00.000Z',
        unit: '1m_tokens',
        inputUsd: 0.2,
        outputUsd: 0.8,
      },
    ],
  },
  agents: {
    factoryProfile: {
      version: 'factory-v1',
      defaultTimeZone: 'Australia/Sydney',
      initialResponsibilitiesSummary: '',
    },
  },
  sandbox: {
    defaultPolicy: 'standard',
    defaultPackageAllowlist: 'default-runtime-pnpm',
    policies: [
      {
        name: 'standard',
        description: 'Default policy.',
        allowFilesystemWriteUnder: ['/work', '/home', '/artifacts'],
        blockFilesystemPaths: ['/work/.git'],
        allowOutboundHosts: ['api.telegram.org', 'registry.npmjs.org'],
        blockOutboundHosts: ['169.254.169.254'],
        allowCommands: ['curl', 'echo', 'node', 'pnpm'],
        resourceLimits: {
          defaultTimeoutMs: 10000,
          maxTimeoutMs: 60000,
          maxOutputBytes: 32768,
          maxMemoryMb: 1024,
          maxCpuSeconds: 30,
        },
      },
    ],
    packageAllowlists: [
      {
        name: 'default-runtime-pnpm',
        packageManager: 'pnpm',
        packages: ['zod'],
      },
    ],
  },
  capabilities: {
    registry: [
      {
        id: 'sandbox.shell',
        name: 'Sandbox shell execution',
        description: 'Runs commands inside the sandbox.',
        category: 'tool',
      },
    ],
  },
};

describe('sandbox policy helpers', () => {
  it('allows allowlisted commands and package installs', () => {
    const validation = validateSandboxCommand({
      allowlist: resolveSandboxPackageAllowlist(repositoryConfig),
      command: 'pnpm add zod',
      policy: resolveSandboxPolicy(repositoryConfig),
    });

    expect(validation).toMatchObject({
      allowed: true,
      commandName: 'pnpm',
      installRequest: {
        packageManager: 'pnpm',
        packages: ['zod'],
      },
    });
  });

  it('denies blocked outbound destinations before execution', () => {
    const validation = validateSandboxCommand({
      allowlist: resolveSandboxPackageAllowlist(repositoryConfig),
      command: 'curl http://169.254.169.254/metadata/instance',
      policy: resolveSandboxPolicy(repositoryConfig),
    });

    expect(validation).toMatchObject({
      allowed: false,
      failureCode: 'outbound_host_denied',
    });
  });

  it('blocks working-directory traversal outside the allowed roots', () => {
    expect(() =>
      resolveSandboxPath({
        workspaceRoot: '/tmp/sbx_session',
        currentWorkingDirectory: '/tmp/sbx_session/work/project',
        candidatePath: '../..',
        policy: resolveSandboxPolicy(repositoryConfig),
      }),
    ).toThrow();
  });

  it('clamps requested timeouts and derives deterministic session identifiers', () => {
    const policy = resolveSandboxPolicy(repositoryConfig);

    expect(clampSandboxTimeoutMs(policy, 999999)).toBe(policy.resourceLimits.maxTimeoutMs);
    expect(
      createDeterministicSandboxSessionId('agt_test', 'hnd_test', policy.name),
    ).toBe(createDeterministicSandboxSessionId('agt_test', 'hnd_test', policy.name));
  });
});

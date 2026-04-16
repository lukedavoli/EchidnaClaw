import { resolve, sep } from 'node:path';

import type {
  PackageAllowlist,
  RepositoryConfig,
  SandboxPackageManager,
  SandboxPolicy,
} from '@echidna-claw/contracts';

const TOKEN_PATTERN = /"[^"]*"|'[^']*'|\S+/g;
const SYSTEM_PACKAGE_MANAGERS = new Set([
  'apt',
  'apt-get',
  'apk',
  'brew',
  'choco',
  'dnf',
  'winget',
  'yum',
]);
const DENIED_COMMANDS = new Set(['docker', 'kubectl', 'podman', 'runas', 'sudo', 'su']);
const FLAG_VALUE_OPTIONS = new Set([
  '--extra-index-url',
  '--index-url',
  '--registry',
  '--requirement',
  '-r',
]);
const GLOBAL_INSTALL_FLAGS = new Set(['--global', '-g']);

export type SandboxCommandInstallRequest = {
  packageManager: SandboxPackageManager;
  packages: string[];
};

export type SandboxCommandValidationResult =
  | {
      allowed: true;
      commandName: string;
      installRequest: SandboxCommandInstallRequest | null;
      requestedHosts: string[];
      requestedPaths: string[];
      tokens: string[];
    }
  | {
      allowed: false;
      failureCode: string;
      failureMessage: string;
    };

function trimToken(token: string): string {
  return token.replace(/^['"]|['"]$/g, '').trim();
}

function normalizeCommandName(token: string): string {
  const value = trimToken(token).replace(/[\\/]+$/, '');
  const parts = value.split(/[\\/]/);
  return (parts.at(-1) ?? '').toLowerCase();
}

function matchesPattern(value: string, pattern: string): boolean {
  const normalizedValue = value.trim().toLowerCase();
  const normalizedPattern = pattern.trim().toLowerCase();

  if (!normalizedPattern.includes('*')) {
    return normalizedValue === normalizedPattern;
  }

  const escaped = normalizedPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i').test(normalizedValue);
}

function tokenizeCommand(command: string): string[] {
  return (command.match(TOKEN_PATTERN) ?? []).map(trimToken).filter(Boolean);
}

function isPathLike(token: string): boolean {
  return (
    token.startsWith('/') ||
    token.startsWith('.\\') ||
    token.startsWith('./') ||
    token.startsWith('..\\') ||
    token.startsWith('../') ||
    token.startsWith('~') ||
    /^[A-Za-z]:[\\/]/.test(token)
  );
}

function parseRequestedHost(token: string): string | null {
  const value = trimToken(token);

  if (/^https?:\/\//i.test(value)) {
    try {
      return new URL(value).hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  const gitMatch = value.match(/^[^@]+@([^:]+):/);
  if (gitMatch?.[1]) {
    return gitMatch[1].toLowerCase();
  }

  return null;
}

function normalizeRequestedPackageName(
  packageManager: SandboxPackageManager,
  packageSpecifier: string,
): string {
  const value = trimToken(packageSpecifier);

  if (packageManager === 'pip') {
    return value.split(/[<>=!~]/, 1)[0] ?? value;
  }

  if (!value.startsWith('@')) {
    return value.split('@', 1)[0] ?? value;
  }

  const lastAt = value.lastIndexOf('@');
  const slashIndex = value.indexOf('/');
  if (lastAt > slashIndex) {
    return value.slice(0, lastAt);
  }

  return value;
}

function collectInstallPackages(args: string[]): {
  globalInstallRequested: boolean;
  packages: string[];
  unsupportedSpecifier: boolean;
} {
  const packages: string[] = [];
  let skipNext = false;
  let globalInstallRequested = false;
  let unsupportedSpecifier = false;

  for (const arg of args) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    if (FLAG_VALUE_OPTIONS.has(arg)) {
      skipNext = true;
      continue;
    }

    if (GLOBAL_INSTALL_FLAGS.has(arg)) {
      globalInstallRequested = true;
      continue;
    }

    if (arg.startsWith('-')) {
      continue;
    }

    if (isPathLike(arg) || /^file:/i.test(arg) || /^https?:\/\//i.test(arg)) {
      unsupportedSpecifier = true;
      continue;
    }

    packages.push(arg);
  }

  return {
    globalInstallRequested,
    packages,
    unsupportedSpecifier,
  };
}

function parseInstallRequest(tokens: string[]): SandboxCommandInstallRequest | null {
  const commandName = normalizeCommandName(tokens[0] ?? '');
  const subcommand = (tokens[1] ?? '').toLowerCase();

  switch (commandName) {
    case 'npm':
      if (subcommand === 'i' || subcommand === 'install') {
        return {
          packageManager: 'npm',
          packages: collectInstallPackages(tokens.slice(2)).packages,
        };
      }
      return null;
    case 'pnpm':
      if (subcommand === 'add' || subcommand === 'i' || subcommand === 'install') {
        return {
          packageManager: 'pnpm',
          packages: collectInstallPackages(tokens.slice(2)).packages,
        };
      }
      return null;
    case 'pip':
      if (subcommand === 'install') {
        return {
          packageManager: 'pip',
          packages: collectInstallPackages(tokens.slice(2)).packages,
        };
      }
      return null;
    default:
      return null;
  }
}

function validateInstallRequest(input: {
  allowlist: PackageAllowlist | null;
  tokens: string[];
}): SandboxCommandValidationResult | null {
  const commandName = normalizeCommandName(input.tokens[0] ?? '');

  if (SYSTEM_PACKAGE_MANAGERS.has(commandName)) {
    return {
      allowed: false,
      failureCode: 'package_manager_denied',
      failureMessage: `Package manager '${commandName}' is not allowed in the sandbox.`,
    };
  }

  const installRequest = parseInstallRequest(input.tokens);
  if (installRequest == null) {
    return null;
  }

  const collectedPackages = collectInstallPackages(input.tokens.slice(2));
  if (collectedPackages.globalInstallRequested) {
    return {
      allowed: false,
      failureCode: 'global_install_denied',
      failureMessage: 'Global package installation is not allowed in the sandbox.',
    };
  }

  if (collectedPackages.unsupportedSpecifier) {
    return {
      allowed: false,
      failureCode: 'package_specifier_denied',
      failureMessage: 'Only allowlisted registry package installs are allowed in the sandbox.',
    };
  }

  if (input.allowlist == null) {
    return {
      allowed: false,
      failureCode: 'package_allowlist_missing',
      failureMessage: 'This session does not allow runtime package installation.',
    };
  }

  if (installRequest.packageManager !== input.allowlist.packageManager) {
    return {
      allowed: false,
      failureCode: 'package_manager_mismatch',
      failureMessage: `Package manager '${installRequest.packageManager}' is not allowed for this session.`,
    };
  }

  if (installRequest.packages.length === 0) {
    return {
      allowed: false,
      failureCode: 'package_specifier_missing',
      failureMessage: 'Install commands must name explicit allowlisted packages.',
    };
  }

  for (const packageSpecifier of installRequest.packages) {
    const normalizedPackage = normalizeRequestedPackageName(
      installRequest.packageManager,
      packageSpecifier,
    );
    const allowed = input.allowlist.packages.some((pattern) =>
      matchesPattern(normalizedPackage, pattern),
    );

    if (!allowed) {
      return {
        allowed: false,
        failureCode: 'package_not_allowlisted',
        failureMessage: `Package '${normalizedPackage}' is not on the allowlist for this session.`,
      };
    }
  }

  return {
    allowed: true,
    commandName,
    installRequest,
    requestedHosts: [],
    requestedPaths: [],
    tokens: input.tokens,
  };
}

function collectRequestedHosts(tokens: string[]): string[] {
  const hosts = new Set<string>();
  let skipNext = false;

  for (const token of tokens.slice(1)) {
    if (skipNext) {
      const host = parseRequestedHost(token);
      if (host) {
        hosts.add(host);
      }
      skipNext = false;
      continue;
    }

    if (FLAG_VALUE_OPTIONS.has(token)) {
      skipNext = true;
      continue;
    }

    const host = parseRequestedHost(token);
    if (host) {
      hosts.add(host);
    }
  }

  return [...hosts];
}

function collectRequestedPaths(tokens: string[]): string[] {
  return tokens.slice(1).filter((token) => isPathLike(token));
}

export function resolveSandboxPolicy(
  repositoryConfig: RepositoryConfig,
  policyName = repositoryConfig.sandbox.defaultPolicy,
): SandboxPolicy {
  const policy = repositoryConfig.sandbox.policies.find((candidate) => candidate.name === policyName);
  if (!policy) {
    throw new Error(`Sandbox policy '${policyName}' was not found in repository config.`);
  }

  return policy;
}

export function resolveSandboxPackageAllowlist(
  repositoryConfig: RepositoryConfig,
  allowlistName = repositoryConfig.sandbox.defaultPackageAllowlist,
): PackageAllowlist {
  const allowlist = repositoryConfig.sandbox.packageAllowlists.find(
    (candidate) => candidate.name === allowlistName,
  );
  if (!allowlist) {
    throw new Error(`Sandbox package allowlist '${allowlistName}' was not found in repository config.`);
  }

  return allowlist;
}

export function clampSandboxTimeoutMs(
  policy: SandboxPolicy,
  requestedTimeoutMs?: number,
): number {
  if (requestedTimeoutMs == null) {
    return policy.resourceLimits.defaultTimeoutMs;
  }

  return Math.min(Math.max(requestedTimeoutMs, 1), policy.resourceLimits.maxTimeoutMs);
}

export function resolveSandboxPath(input: {
  workspaceRoot: string;
  currentWorkingDirectory: string;
  candidatePath: string;
  policy: SandboxPolicy;
}): string {
  const workspaceRoot = resolve(input.workspaceRoot);
  const candidate = trimToken(input.candidatePath);
  const absoluteCandidate =
    candidate.startsWith('~')
      ? resolve(workspaceRoot, 'home', candidate.slice(1))
      : resolve(
          /^[A-Za-z]:[\\/]/.test(candidate) || candidate.startsWith('/')
            ? candidate
            : resolve(input.currentWorkingDirectory, candidate),
        );

  const allowedRoots = input.policy.allowFilesystemWriteUnder.map((entry) => {
    const normalized = entry.replace(/^[\\/]+/, '');
    return normalized.length === 0 ? workspaceRoot : resolve(workspaceRoot, normalized);
  });
  const blockedRoots = input.policy.blockFilesystemPaths.map((entry) => {
    const normalized = entry.replace(/^[\\/]+/, '');
    return normalized.length === 0 ? workspaceRoot : resolve(workspaceRoot, normalized);
  });

  if (
    blockedRoots.some(
      (blockedRoot) =>
        absoluteCandidate === blockedRoot ||
        absoluteCandidate.startsWith(`${blockedRoot}${sep}`),
    )
  ) {
    throw new Error(`Filesystem path '${candidate}' is blocked by sandbox policy.`);
  }

  if (
    !allowedRoots.some(
      (allowedRoot) =>
        absoluteCandidate === allowedRoot ||
        absoluteCandidate.startsWith(`${allowedRoot}${sep}`),
    )
  ) {
    throw new Error(`Filesystem path '${candidate}' is outside the allowed sandbox workspace roots.`);
  }

  return absoluteCandidate;
}

export function validateSandboxCommand(input: {
  allowlist: PackageAllowlist | null;
  command: string;
  policy: SandboxPolicy;
}): SandboxCommandValidationResult {
  const tokens = tokenizeCommand(input.command);
  if (tokens.length === 0) {
    return {
      allowed: false,
      failureCode: 'command_missing',
      failureMessage: 'The sandbox command cannot be empty.',
    };
  }

  const commandName = normalizeCommandName(tokens[0] ?? '');
  if (DENIED_COMMANDS.has(commandName)) {
    return {
      allowed: false,
      failureCode: 'command_denied',
      failureMessage: `Command '${commandName}' is blocked by sandbox policy.`,
    };
  }

  if (
    !input.policy.allowCommands.some((allowedCommand) => matchesPattern(commandName, allowedCommand))
  ) {
    return {
      allowed: false,
      failureCode: 'command_not_allowlisted',
      failureMessage: `Command '${commandName}' is not on the sandbox allowlist.`,
    };
  }

  const installValidation = validateInstallRequest({
    allowlist: input.allowlist,
    tokens,
  });
  if (installValidation?.allowed === false) {
    return installValidation;
  }

  const requestedHosts = collectRequestedHosts(tokens);
  for (const host of requestedHosts) {
    if (input.policy.blockOutboundHosts.some((pattern) => matchesPattern(host, pattern))) {
      return {
        allowed: false,
        failureCode: 'outbound_host_denied',
        failureMessage: `Outbound host '${host}' is blocked by sandbox policy.`,
      };
    }

    if (
      input.policy.allowOutboundHosts.length > 0 &&
      !input.policy.allowOutboundHosts.some((pattern) => matchesPattern(host, pattern))
    ) {
      return {
        allowed: false,
        failureCode: 'outbound_host_not_allowlisted',
        failureMessage: `Outbound host '${host}' is not allowed by sandbox policy.`,
      };
    }
  }

  return {
    allowed: true,
    commandName,
    installRequest: installValidation?.allowed ? installValidation.installRequest : parseInstallRequest(tokens),
    requestedHosts,
    requestedPaths: collectRequestedPaths(tokens),
    tokens,
  };
}

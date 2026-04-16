import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { type SandboxConfig, loadRepositoryConfig } from '@echidna-claw/config';
import {
  sandboxCloseSessionRequestSchema,
  sandboxExecuteCommandRequestSchema,
  sandboxExecuteCommandResultSchema,
  sandboxProvisionSessionRequestSchema,
  type PackageAllowlist,
  type RepositoryConfig,
  type SandboxCloseSessionRequest,
  type SandboxExecuteCommandRequest,
  type SandboxExecuteCommandResult,
  type SandboxProvisionSessionRequest,
  type SandboxSession,
} from '@echidna-claw/contracts';
import {
  clampSandboxTimeoutMs,
  resolveSandboxPackageAllowlist,
  resolveSandboxPath,
  resolveSandboxPolicy,
  validateSandboxCommand,
} from '@echidna-claw/domain';

import type { SandboxCredentialResolver } from './credentials.js';
import {
  SandboxConflictError,
  SandboxNotFoundError,
} from './errors.js';

const WORK_DIRECTORY_NAME = 'work';
const HOME_DIRECTORY_NAME = 'home';
const ARTIFACTS_DIRECTORY_NAME = 'artifacts';
const CWD_MARKER = '__ECHIDNA_SANDBOX_CWD__=';

type RuntimeSession = {
  activeChild: ChildProcessWithoutNullStreams | null;
  cancellationRequested: boolean;
  closed: boolean;
  installedPackages: string[];
  packageAllowlist: PackageAllowlist | null;
  session: SandboxSession;
};

function appendBoundedText(input: {
  chunk: Buffer;
  currentText: string;
  outputLimitBytes: number;
  totalBytes: number;
}): {
  nextText: string;
  nextTotalBytes: number;
  truncated: boolean;
} {
  if (input.totalBytes >= input.outputLimitBytes) {
    return {
      nextText: input.currentText,
      nextTotalBytes: input.totalBytes,
      truncated: true,
    };
  }

  const remainingBytes = input.outputLimitBytes - input.totalBytes;
  if (input.chunk.byteLength <= remainingBytes) {
    return {
      nextText: input.currentText + input.chunk.toString('utf8'),
      nextTotalBytes: input.totalBytes + input.chunk.byteLength,
      truncated: false,
    };
  }

  return {
    nextText: input.currentText + input.chunk.subarray(0, remainingBytes).toString('utf8'),
    nextTotalBytes: input.outputLimitBytes,
    truncated: true,
  };
}

function parseWorkingDirectoryMarker(stdoutText: string): {
  resolvedWorkingDirectory: string | null;
  stdoutText: string;
} {
  const markerIndex = stdoutText.lastIndexOf(CWD_MARKER);
  if (markerIndex === -1) {
    return {
      resolvedWorkingDirectory: null,
      stdoutText,
    };
  }

  const markerText = stdoutText.slice(markerIndex);
  const lineBreakIndex = markerText.indexOf('\n');
  const markerLine =
    lineBreakIndex === -1 ? markerText.trim() : markerText.slice(0, lineBreakIndex).trim();
  const resolvedWorkingDirectory = markerLine.slice(CWD_MARKER.length).trim();
  const cleanedStdout = `${stdoutText.slice(0, markerIndex)}${lineBreakIndex === -1 ? '' : markerText.slice(lineBreakIndex + 1)}`.trimEnd();

  return {
    resolvedWorkingDirectory: resolvedWorkingDirectory || null,
    stdoutText: cleanedStdout,
  };
}

function buildBashCommand(command: string): string {
  return `${command}
status=$?
printf '${CWD_MARKER}%s\n' "$PWD"
exit $status`;
}

function buildPowerShellCommand(command: string): string {
  return `& {
${command}
$exitCode = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }
Write-Output "${CWD_MARKER}$((Get-Location).Path)"
exit $exitCode
}`;
}

function resolveShell(requestedShell: SandboxExecuteCommandRequest['shell']): {
  argsPrefix: string[];
  commandBuilder: (command: string) => string;
  executable: string;
} {
  if (requestedShell === 'bash' || (requestedShell === 'default' && process.platform !== 'win32')) {
    return {
      argsPrefix: ['-lc'],
      commandBuilder: buildBashCommand,
      executable: 'bash',
    };
  }

  return {
    argsPrefix: ['-NoLogo', '-NoProfile', '-Command'],
    commandBuilder: buildPowerShellCommand,
    executable: process.platform === 'win32' ? 'powershell.exe' : 'pwsh',
  };
}

async function ensureWorkspaceDirectories(sessionRoot: string): Promise<{
  artifactsDirectory: string;
  homeDirectory: string;
  workDirectory: string;
}> {
  const workDirectory = resolve(sessionRoot, WORK_DIRECTORY_NAME);
  const homeDirectory = resolve(sessionRoot, HOME_DIRECTORY_NAME);
  const artifactsDirectory = resolve(sessionRoot, ARTIFACTS_DIRECTORY_NAME);

  await Promise.all([
    mkdir(workDirectory, { recursive: true }),
    mkdir(homeDirectory, { recursive: true }),
    mkdir(artifactsDirectory, { recursive: true }),
  ]);

  return {
    artifactsDirectory,
    homeDirectory,
    workDirectory,
  };
}

export class LocalSandboxRuntime {
  private readonly repositoryConfig: RepositoryConfig;
  private readonly sessions = new Map<string, RuntimeSession>();

  constructor(
    private readonly config: SandboxConfig,
    private readonly credentialResolver: SandboxCredentialResolver,
    repositoryConfig: RepositoryConfig = loadRepositoryConfig(),
  ) {
    this.repositoryConfig = repositoryConfig;
  }

  async cleanupWorkspaceRoot(): Promise<void> {
    if (!this.config.startupCleanupEnabled) {
      await mkdir(this.config.workspaceRoot, { recursive: true });
      return;
    }

    await rm(this.config.workspaceRoot, {
      force: true,
      recursive: true,
    });
    await mkdir(this.config.workspaceRoot, { recursive: true });
  }

  async createSession(input: SandboxProvisionSessionRequest): Promise<SandboxSession> {
    const request = sandboxProvisionSessionRequestSchema.parse(input);
    const existing = this.sessions.get(request.sessionId);
    if (existing) {
      return existing.session;
    }

    const policy = resolveSandboxPolicy(this.repositoryConfig, request.policyName);
    const packageAllowlistName =
      request.packageAllowlistName ?? this.repositoryConfig.sandbox.defaultPackageAllowlist;
    const packageAllowlist = resolveSandboxPackageAllowlist(
      this.repositoryConfig,
      packageAllowlistName,
    );
    const createdAt = new Date().toISOString();
    const sessionRoot = resolve(
      this.config.workspaceRoot,
      request.agentId,
      request.handsRunId,
      request.sessionId,
    );
    const directories = await ensureWorkspaceDirectories(sessionRoot);
    const resourceProfile = {
      ...policy.resourceLimits,
      defaultTimeoutMs: Math.min(policy.resourceLimits.defaultTimeoutMs, this.config.defaultTimeoutMs),
      maxTimeoutMs: Math.min(policy.resourceLimits.maxTimeoutMs, this.config.maxTimeoutMs),
      maxOutputBytes: Math.min(
        policy.resourceLimits.maxOutputBytes,
        this.config.defaultOutputLimitBytes,
      ),
    };
    const workingDirectory =
      request.workingDirectory == null
        ? directories.workDirectory
        : resolveSandboxPath({
            candidatePath: request.workingDirectory,
            currentWorkingDirectory: directories.workDirectory,
            policy,
            workspaceRoot: sessionRoot,
          });

    const session: SandboxSession = {
      id: request.sessionId,
      recordType: 'sandbox_session',
      schemaVersion: 1,
      createdAt,
      updatedAt: createdAt,
      correlation: {
        ...request.correlation,
        handsRunId: request.handsRunId,
        sandboxSessionId: request.sessionId,
        taskId: request.taskId,
      },
      agentId: request.agentId,
      handsRunId: request.handsRunId,
      taskId: request.taskId,
      state: 'created',
      policyName: policy.name,
      workspaceRoot: sessionRoot,
      workingDirectory,
      resourceProfile,
      packageAllowlistName: packageAllowlist.name,
      credentialBindings: request.credentialBindings,
      credentialAliases: request.credentialAliases,
      commandCount: 0,
      lastCommandStartedAt: null,
      lastCommandCompletedAt: null,
      closedReason: null,
      failureCode: null,
      allowedOutboundHosts: policy.allowOutboundHosts,
      startedAt: createdAt,
      completedAt: null,
    };

    this.sessions.set(request.sessionId, {
      activeChild: null,
      cancellationRequested: false,
      closed: false,
      installedPackages: [],
      packageAllowlist,
      session,
    });

    return session;
  }

  async getSession(sessionId: string): Promise<SandboxSession> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new SandboxNotFoundError(`Sandbox session '${sessionId}' was not found.`);
    }

    return session.session;
  }

  async executeCommand(input: SandboxExecuteCommandRequest): Promise<SandboxExecuteCommandResult> {
    const request = sandboxExecuteCommandRequestSchema.parse(input);
    const runtimeSession = this.sessions.get(request.sessionId);
    if (!runtimeSession) {
      throw new SandboxNotFoundError(`Sandbox session '${request.sessionId}' was not found.`);
    }

    if (runtimeSession.closed) {
      throw new SandboxConflictError('Sandbox session is already closed.');
    }

    const policy = resolveSandboxPolicy(this.repositoryConfig, runtimeSession.session.policyName);
    const validation = validateSandboxCommand({
      allowlist: runtimeSession.packageAllowlist,
      command: request.command,
      policy,
    });
    const startedAt = new Date().toISOString();

    if (!validation.allowed) {
      return sandboxExecuteCommandResultSchema.parse({
        sessionId: request.sessionId,
        status: 'policy_denied',
        startedAt,
        completedAt: startedAt,
        durationMs: 0,
        exitCode: null,
        signal: null,
        stdoutText: '',
        stderrText: '',
        outputTruncated: false,
        resolvedWorkingDirectory: runtimeSession.session.workingDirectory,
        artifactIds: [],
        failureCode: validation.failureCode,
        failureMessage: validation.failureMessage,
      });
    }

    let commandWorkingDirectory = runtimeSession.session.workingDirectory;
    try {
      if (request.workingDirectory != null) {
        commandWorkingDirectory = resolveSandboxPath({
          candidatePath: request.workingDirectory,
          currentWorkingDirectory: runtimeSession.session.workingDirectory,
          policy,
          workspaceRoot: runtimeSession.session.workspaceRoot,
        });
      }

      for (const requestedPath of validation.requestedPaths) {
        resolveSandboxPath({
          candidatePath: requestedPath,
          currentWorkingDirectory: commandWorkingDirectory,
          policy,
          workspaceRoot: runtimeSession.session.workspaceRoot,
        });
      }
    } catch (error) {
      const failureMessage =
        error instanceof Error ? error.message : 'Filesystem path is blocked by sandbox policy.';

      return sandboxExecuteCommandResultSchema.parse({
        sessionId: request.sessionId,
        status: 'policy_denied',
        startedAt,
        completedAt: startedAt,
        durationMs: 0,
        exitCode: null,
        signal: null,
        stdoutText: '',
        stderrText: '',
        outputTruncated: false,
        resolvedWorkingDirectory: runtimeSession.session.workingDirectory,
        artifactIds: [],
        failureCode: 'filesystem_path_denied',
        failureMessage,
      });
    }

    const shell = resolveShell(request.shell);
    const timeoutMs = clampSandboxTimeoutMs(policy, request.timeoutMs);
    const environmentBindings = await this.credentialResolver.resolveBindings({
      credentialBindings: runtimeSession.session.credentialBindings,
      sessionId: request.sessionId,
    });
    const homeDirectory = resolve(runtimeSession.session.workspaceRoot, HOME_DIRECTORY_NAME);
    const tempDirectory = resolve(tmpdir(), 'echidna-claw', request.sessionId);
    await mkdir(tempDirectory, { recursive: true });
    const commandScript = shell.commandBuilder(request.command);

    let stdoutText = '';
    let stderrText = '';
    let outputBytes = 0;
    let outputTruncated = false;
    let timedOut = false;
    runtimeSession.cancellationRequested = false;

    const child = spawn(shell.executable, [...shell.argsPrefix, commandScript], {
      cwd: commandWorkingDirectory,
      env: {
        ...process.env,
        ...environmentBindings,
        HOME: homeDirectory,
        TMPDIR: tempDirectory,
      },
      stdio: 'pipe',
      windowsHide: true,
    });
    runtimeSession.activeChild = child;
    runtimeSession.session = {
      ...runtimeSession.session,
      lastCommandStartedAt: startedAt,
      state: 'running',
      updatedAt: startedAt,
    };

    child.stdout.on('data', (chunk: Buffer) => {
      const appended = appendBoundedText({
        chunk,
        currentText: stdoutText,
        outputLimitBytes: runtimeSession.session.resourceProfile.maxOutputBytes,
        totalBytes: outputBytes,
      });
      stdoutText = appended.nextText;
      outputBytes = appended.nextTotalBytes;
      outputTruncated ||= appended.truncated;
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const appended = appendBoundedText({
        chunk,
        currentText: stderrText,
        outputLimitBytes: runtimeSession.session.resourceProfile.maxOutputBytes,
        totalBytes: outputBytes,
      });
      stderrText = appended.nextText;
      outputBytes = appended.nextTotalBytes;
      outputTruncated ||= appended.truncated;
    });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    const { exitCode, signal } = await new Promise<{
      exitCode: number | null;
      signal: NodeJS.Signals | null;
    }>((resolvePromise, rejectPromise) => {
      child.on('error', rejectPromise);
      child.on('exit', (nextExitCode, nextSignal) => {
        resolvePromise({
          exitCode: nextExitCode,
          signal: nextSignal,
        });
      });
    }).finally(() => {
      clearTimeout(timeoutHandle);
      runtimeSession.activeChild = null;
    });

    const completedAt = new Date().toISOString();
    const parsedStdout = parseWorkingDirectoryMarker(stdoutText);
    const resolvedWorkingDirectory = parsedStdout.resolvedWorkingDirectory ?? commandWorkingDirectory;
    let status: SandboxExecuteCommandResult['status'];
    let failureCode: string | undefined;
    let failureMessage: string | undefined;

    if (runtimeSession.cancellationRequested) {
      status = 'cancelled';
      failureCode = 'command_cancelled';
      failureMessage = 'The command was cancelled while the session was closing.';
    } else if (timedOut) {
      status = 'timed_out';
      failureCode = 'command_timed_out';
      failureMessage = `The command exceeded the timeout of ${timeoutMs}ms.`;
    } else if (exitCode === 0) {
      status = 'completed';
    } else {
      status = 'failed';
      failureCode = 'command_failed';
      failureMessage = `The command exited with code ${exitCode ?? 'unknown'}.`;
    }

    if (validation.installRequest && status === 'completed') {
      runtimeSession.installedPackages.push(...validation.installRequest.packages);
    }

    runtimeSession.session = {
      ...runtimeSession.session,
      commandCount: runtimeSession.session.commandCount + 1,
      completedAt: runtimeSession.session.completedAt,
      failureCode: failureCode ?? null,
      lastCommandCompletedAt: completedAt,
      state: 'created',
      updatedAt: completedAt,
      workingDirectory: resolvedWorkingDirectory,
    };

    return sandboxExecuteCommandResultSchema.parse({
      sessionId: request.sessionId,
      status,
      startedAt,
      completedAt,
      durationMs: Math.max(Date.parse(completedAt) - Date.parse(startedAt), 0),
      exitCode,
      signal,
      stdoutText: parsedStdout.stdoutText,
      stderrText,
      outputTruncated,
      resolvedWorkingDirectory,
      artifactIds: [],
      failureCode,
      failureMessage,
    });
  }

  async closeSession(input: SandboxCloseSessionRequest): Promise<SandboxSession> {
    const request = sandboxCloseSessionRequestSchema.parse(input);
    const runtimeSession = this.sessions.get(request.sessionId);
    if (!runtimeSession) {
      throw new SandboxNotFoundError(`Sandbox session '${request.sessionId}' was not found.`);
    }

    if (runtimeSession.activeChild) {
      runtimeSession.cancellationRequested = true;
      runtimeSession.activeChild.kill();
    }

    await rm(runtimeSession.session.workspaceRoot, {
      force: true,
      recursive: true,
    });

    const completedAt = new Date().toISOString();
    runtimeSession.closed = true;
    runtimeSession.session = {
      ...runtimeSession.session,
      closedReason: request.reason,
      completedAt,
      state: request.reason === 'cancelled' ? 'cancelled' : 'completed',
      updatedAt: completedAt,
    };

    return runtimeSession.session;
  }
}

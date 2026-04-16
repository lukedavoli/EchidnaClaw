import type { HandsHandlerOutcome } from '@echidna-claw/contracts';

import type {
  HandsTaskHandler,
  HandsTaskHandlerContext,
  RuntimeScript,
} from './types.js';

function coerceScript(notes: string): RuntimeScript | null {
  const trimmed = notes.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as RuntimeScript;
  } catch {
    return null;
  }
}

function buildDefaultSummary(context: HandsTaskHandlerContext): string {
  return `Completed Hands task: ${context.task.requestedOutcome}`;
}

async function maybeRunSandboxCommand(
  context: HandsTaskHandlerContext,
  script: RuntimeScript,
): Promise<void> {
  if (!script.sandboxCommand) {
    return;
  }

  const session = await context.sandbox.createSession({
    credentialBindings: [],
    credentialAliases: [],
    packageAllowlistName: script.sandboxCommand.packageAllowlistName,
    policyName: script.sandboxCommand.policyName ?? 'standard',
    workingDirectory: script.sandboxCommand.workingDirectory,
    workspaceLabel: `${context.task.type}-${context.task.id}`,
  });
  const result = await context.sandbox.executeCommand({
    command: script.sandboxCommand.command,
    sessionId: session.id,
    shell: script.sandboxCommand.shell ?? 'default',
    timeoutMs: script.sandboxCommand.timeoutMs,
    workingDirectory: script.sandboxCommand.workingDirectory,
  });

  await context.reportProgress({
    artifactIds: [],
    entryKind: 'action',
    handsActionSummary: `Sandbox command status=${result.status} exit=${result.exitCode ?? 'n/a'}.`,
    headline: 'Sandbox command finished.',
    level: 'info',
    message:
      result.stdoutText.trim() !== ''
        ? result.stdoutText.trim()
        : result.stderrText.trim() || `Sandbox command returned ${result.status}.`,
    waitingForUser: false,
  });
}

function buildScriptedOutcome(
  context: HandsTaskHandlerContext,
  script: RuntimeScript,
): HandsHandlerOutcome {
  const summary = script.summary ?? buildDefaultSummary(context);

  switch (script.outcome) {
    case 'failed':
      return {
        artifactIds: [],
        failureCode: script.failureCode ?? 'runtime_test_failed',
        failureMessage: script.failureMessage ?? 'Runtime script requested failure.',
        followUpTasks: script.followUpTasks ?? [],
        kind: 'failed',
        retryable: false,
        summary,
      };
    case 'waiting_for_user':
      return {
        followUpTasks: script.followUpTasks ?? [],
        kind: 'waiting_for_user',
        openQuestions: script.openQuestions ?? ['What should Hands do next?'],
        summary,
      };
    case 'deferred':
      return {
        dueAt: script.dueAt ?? new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        followUpTasks: script.followUpTasks ?? [],
        kind: 'deferred',
        resultCode: script.resultCode,
        summary,
      };
    case 'cancelled':
      return {
        kind: 'cancelled',
        resultCode: script.resultCode ?? 'cancelled',
        summary,
      };
    default:
      return {
        artifactIds: [],
        externalReferences: [],
        followUpTasks: script.followUpTasks ?? [],
        kind: 'completed',
        resultCode: script.resultCode ?? 'completed',
        summary,
      };
  }
}

function createScriptedHandler(taskType: string): HandsTaskHandler {
  return {
    canHandle(candidateTaskType) {
      return candidateTaskType === taskType;
    },
    async execute(context): Promise<HandsHandlerOutcome> {
      const script = coerceScript(context.taskEnvelope.notes) ?? {};

      await context.reportProgress({
        artifactIds: [],
        entryKind: 'progress',
        headline: `Hands is working on: ${context.task.requestedOutcome}`,
        level: 'info',
        message: `Hands claimed ${context.task.type} work.`,
        percentComplete: 10,
        waitingForUser: false,
      });

      for (const message of script.progressMessages ?? []) {
        await context.reportProgress({
          artifactIds: [],
          entryKind: 'progress',
          headline: `Hands is working on: ${context.task.requestedOutcome}`,
          level: 'info',
          message,
          waitingForUser: false,
        });
      }

      await maybeRunSandboxCommand(context, script);
      return buildScriptedOutcome(context, script);
    },
  };
}

export function createDefaultHandlers(): readonly HandsTaskHandler[] {
  return [
    createScriptedHandler('follow_up'),
    createScriptedHandler('system'),
    createScriptedHandler('runtime_test'),
  ];
}

import type { HeadTurn, TaskStatusSnapshot } from '@echidna-claw/contracts';

export function handleReadStatus(input: {
  activeHeadTurnCount: number;
  focus?: 'approvals' | 'credentials' | 'summary' | 'tasks';
  headTurn: HeadTurn;
  snapshot: TaskStatusSnapshot;
}): string {
  const lines = [
    `Current head turn id: ${input.headTurn.id}`,
    `Current head turn state: ${input.headTurn.state}`,
    `Active head turns: ${input.activeHeadTurnCount}`,
    `Working-context summary: ${input.snapshot.workingContextSummary || 'No summary is currently stored.'}`,
    `Open tasks: ${input.snapshot.openTasks.length}`,
    `Active schedules: ${input.snapshot.schedules.length}`,
    `Pending approvals: ${input.snapshot.pendingApprovalIds.length}`,
    `Pending credential captures: ${input.snapshot.pendingCredentialCaptureIds.length}`,
  ];

  if (input.focus === 'approvals') {
    lines.push(
      ...(input.snapshot.pendingApprovalItems.length > 0
        ? input.snapshot.pendingApprovalItems.map(
            (approval) =>
              `- approval ${approval.approvalId}: ${approval.state} category=${approval.category} task=${approval.taskId} summary="${approval.summary}" expiresAt=${approval.expiresAt ?? 'none'}`,
          )
        : ['- No pending approvals.']),
    );
    return lines.join('\n');
  }

  if (input.focus === 'credentials') {
    lines.push(
      ...(input.snapshot.pendingCredentialCaptureItems.length > 0
        ? input.snapshot.pendingCredentialCaptureItems.map(
            (capture) =>
              `- credential ${capture.credentialCaptureId}: ${capture.state} alias=${capture.alias} displayName="${capture.displayName}" task=${capture.taskId ?? 'none'} resume=${capture.willResumeTask ? 'automatic' : 'none'}`,
          )
        : ['- No pending credential captures.']),
    );
    return lines.join('\n');
  }

  if (input.focus === 'tasks' || input.focus === 'summary' || input.focus == null) {
    const taskLines =
      input.snapshot.openTasks.length > 0
        ? input.snapshot.openTasks.map((task) => {
            const progress = task.progressSummary?.headline ?? 'No progress summary.';
            const launchState =
              task.launchState.status === 'failed' && task.launchState.lastErrorMessage
                ? `launch=${task.launchState.status} (${task.launchState.lastErrorMessage})`
                : `launch=${task.launchState.status}`;
            const dueAt = task.dueAt ? ` dueAt=${task.dueAt}` : '';
            const runSummary = task.runSummary?.summary
              ? ` journal=${task.runSummary.summary}`
              : '';

            return `- ${task.taskId}: ${task.state} ${task.queue.lane}/${task.queue.priority}${dueAt} ${launchState} outcome="${task.requestedOutcome}" progress="${progress}"${runSummary}`;
          })
        : ['- No open tasks.'];

    lines.push(...taskLines);
    lines.push(
      ...(input.snapshot.schedules.length > 0
        ? input.snapshot.schedules.map(
            (schedule) =>
              `- schedule ${schedule.scheduleId}: ${schedule.state} nextDueAt=${schedule.nextDueAt ?? 'none'} description="${schedule.description}"`,
          )
        : ['- No active schedules.']),
    );
  }

  return lines.join('\n');
}

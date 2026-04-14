import type { HeadTurn, TaskStatusSnapshot } from '@echidna-claw/contracts';

export function handleReadStatus(input: {
  activeHeadTurnCount: number;
  focus?: 'approvals' | 'summary' | 'tasks';
  headTurn: HeadTurn;
  snapshot: TaskStatusSnapshot;
}): string {
  const lines = [
    `Current head turn id: ${input.headTurn.id}`,
    `Current head turn state: ${input.headTurn.state}`,
    `Active head turns: ${input.activeHeadTurnCount}`,
    `Working-context summary: ${input.snapshot.workingContextSummary || 'No summary is currently stored.'}`,
    `Open tasks: ${input.snapshot.openTasks.length}`,
    `Pending approvals: ${input.snapshot.pendingApprovalIds.length}`,
  ];

  if (input.focus === 'approvals') {
    lines.push(
      `Approval ids: ${
        input.snapshot.pendingApprovalIds.length > 0
          ? input.snapshot.pendingApprovalIds.join(', ')
          : 'None.'
      }`,
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
            const runSummary = task.runSummary?.summary
              ? ` journal=${task.runSummary.summary}`
              : '';

            return `- ${task.taskId}: ${task.state} ${task.queue.lane}/${task.queue.priority} ${launchState} outcome="${task.requestedOutcome}" progress="${progress}"${runSummary}`;
          })
        : ['- No open tasks.'];

    lines.push(...taskLines);
  }

  return lines.join('\n');
}

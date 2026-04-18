import type { Task } from '@echidna-claw/contracts';

export function findTaskByOutcome(
  tasks: readonly { value: Task }[],
  requestedOutcome: string,
): Task | undefined {
  return tasks.find((task) => task.value.requestedOutcome === requestedOutcome)?.value;
}

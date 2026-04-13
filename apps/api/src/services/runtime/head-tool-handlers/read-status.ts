import type { HeadTurn } from '@echidna-claw/contracts';

export function handleReadStatus(input: {
  activeHeadTurnCount: number;
  headTurn: HeadTurn;
  workingContextSummary: string;
}): string {
  return [
    `Current head turn id: ${input.headTurn.id}`,
    `Current head turn state: ${input.headTurn.state}`,
    `Active head turns: ${input.activeHeadTurnCount}`,
    `Working-context summary: ${input.workingContextSummary || 'No summary is currently stored.'}`,
  ].join('\n');
}

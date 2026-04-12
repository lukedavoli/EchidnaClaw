import { type HandsRun, type HeadTurn } from '@echidna-claw/contracts';

const activeHeadTurnStates = new Set(['queued', 'running']);
const activeHandsRunStates = new Set(['queued', 'running']);

export function getActiveHeadTurnsForAgent(headTurns: readonly HeadTurn[], agentId: string): HeadTurn[] {
  return headTurns.filter(
    (headTurn) => headTurn.agentId === agentId && activeHeadTurnStates.has(headTurn.state),
  );
}

export function getActiveHandsRunsForAgent(handsRuns: readonly HandsRun[], agentId: string): HandsRun[] {
  return handsRuns.filter(
    (handsRun) => handsRun.agentId === agentId && activeHandsRunStates.has(handsRun.state),
  );
}

export function assertSingleActiveHeadTurn(headTurns: readonly HeadTurn[], agentId: string): void {
  if (getActiveHeadTurnsForAgent(headTurns, agentId).length > 1) {
    throw new Error(`Agent ${agentId} has more than one active Head turn`);
  }
}

export function assertSingleActiveHandsRun(handsRuns: readonly HandsRun[], agentId: string): void {
  if (getActiveHandsRunsForAgent(handsRuns, agentId).length > 1) {
    throw new Error(`Agent ${agentId} has more than one active Hands run`);
  }
}

export function canStartHeadTurn(headTurns: readonly HeadTurn[], agentId: string): boolean {
  return getActiveHeadTurnsForAgent(headTurns, agentId).length === 0;
}

export function canStartHandsRun(handsRuns: readonly HandsRun[], agentId: string): boolean {
  return getActiveHandsRunsForAgent(handsRuns, agentId).length === 0;
}

import type { WorkingContext } from '@echidna-claw/contracts';

function addMilliseconds(at: string, milliseconds: number): string {
  return new Date(Date.parse(at) + milliseconds).toISOString();
}

function clearActiveHeadTurnClaim(
  workingContext: WorkingContext,
  updatedAt: string,
): Pick<
  WorkingContext,
  | 'activeHeadTurnId'
  | 'activeHeadTurnStartedAt'
  | 'activeHeadTurnReadThroughSequence'
  | 'updatedAt'
> {
  return {
    activeHeadTurnId: null,
    activeHeadTurnReadThroughSequence: null,
    activeHeadTurnStartedAt: null,
    updatedAt,
  };
}

export function getLocalCalendarDate(input: { at: string; timeZone: string }): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: input.timeZone,
    year: 'numeric',
  });
  const parts = formatter.formatToParts(new Date(input.at));
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error(`Unable to derive the local calendar date for '${input.timeZone}'.`);
  }

  return `${year}-${month}-${day}`;
}

export function shouldRotateEpisode(input: {
  episodeLocalDate: string | null;
  episodeTurnCount: number;
  eventAt: string;
  timeZone: string;
}): boolean {
  const eventLocalDate = getLocalCalendarDate({
    at: input.eventAt,
    timeZone: input.timeZone,
  });

  return (
    input.episodeLocalDate == null ||
    input.episodeLocalDate !== eventLocalDate ||
    input.episodeTurnCount >= 20
  );
}

export function shouldSupersedeTurn(input: {
  activeReadThroughSequence: number | null;
  latestInboundSequence: number;
}): boolean {
  return (
    input.activeReadThroughSequence != null &&
    input.latestInboundSequence > input.activeReadThroughSequence
  );
}

export function applyTrustedIngress(input: {
  debounceWindowMs: number;
  observedAt: string;
  readThroughSequence: number;
  workingContext: WorkingContext;
}): WorkingContext {
  const latestInboundSequence = Math.max(
    input.workingContext.latestInboundSequence,
    input.readThroughSequence,
  );
  const shouldFlagSupersession = shouldSupersedeTurn({
    activeReadThroughSequence: input.workingContext.activeHeadTurnReadThroughSequence,
    latestInboundSequence,
  });

  return {
    ...input.workingContext,
    latestInboundSequence,
    pendingSupersededBySequence: shouldFlagSupersession
      ? Math.max(input.workingContext.pendingSupersededBySequence ?? 0, latestInboundSequence)
      : input.workingContext.pendingSupersededBySequence,
    debounceUntil:
      input.debounceWindowMs > 0
        ? addMilliseconds(input.observedAt, input.debounceWindowMs)
        : null,
    pendingDebounceSequence:
      input.debounceWindowMs > 0 ? latestInboundSequence : null,
    updatedAt: input.observedAt,
  };
}

export function applyEpisodeRotation(input: {
  eventAt: string;
  timeZone: string;
  workingContext: WorkingContext;
}): WorkingContext {
  const rotated = {
    ...input.workingContext,
    conversationCursor: undefined,
    episodeLocalDate: getLocalCalendarDate({
      at: input.eventAt,
      timeZone: input.timeZone,
    }),
    episodeTurnCount: 0,
    updatedAt: input.eventAt,
  };

  if (rotated.activeHeadTurnId != null) {
    return rotated;
  }

  return {
    ...rotated,
    ...clearActiveHeadTurnClaim(rotated, input.eventAt),
    pendingSupersededBySequence: null,
  };
}

export function applyHeadTurnClaim(input: {
  claimedAt: string;
  headTurnId: string;
  readThroughSequence: number | null;
  workingContext: WorkingContext;
}): WorkingContext {
  const claimedReadThroughSequence =
    input.readThroughSequence ?? input.workingContext.activeHeadTurnReadThroughSequence;

  return {
    ...input.workingContext,
    activeHeadTurnId: input.headTurnId,
    activeHeadTurnStartedAt: input.claimedAt,
    activeHeadTurnReadThroughSequence: claimedReadThroughSequence,
    debounceUntil:
      input.workingContext.pendingDebounceSequence != null &&
      claimedReadThroughSequence != null &&
      input.workingContext.pendingDebounceSequence > claimedReadThroughSequence
        ? input.workingContext.debounceUntil
        : null,
    pendingDebounceSequence:
      input.workingContext.pendingDebounceSequence != null &&
      claimedReadThroughSequence != null &&
      input.workingContext.pendingDebounceSequence > claimedReadThroughSequence
        ? input.workingContext.pendingDebounceSequence
        : null,
    latestInboundSequence:
      claimedReadThroughSequence != null
        ? Math.max(input.workingContext.latestInboundSequence, claimedReadThroughSequence)
        : input.workingContext.latestInboundSequence,
    updatedAt: input.claimedAt,
  };
}

export function applyHeadTurnSuperseded(input: {
  headTurnId: string;
  supersededAt: string;
  supersededBySequence: number;
  workingContext: WorkingContext;
}): WorkingContext {
  const nextPendingSupersededBySequence = Math.max(
    input.workingContext.pendingSupersededBySequence ?? 0,
    input.supersededBySequence,
  );

  if (input.workingContext.activeHeadTurnId !== input.headTurnId) {
    return {
      ...input.workingContext,
      latestInboundSequence: Math.max(
        input.workingContext.latestInboundSequence,
        input.supersededBySequence,
      ),
      pendingSupersededBySequence: nextPendingSupersededBySequence,
      updatedAt: input.supersededAt,
    };
  }

  return {
    ...input.workingContext,
    ...clearActiveHeadTurnClaim(input.workingContext, input.supersededAt),
    latestInboundSequence: Math.max(
      input.workingContext.latestInboundSequence,
      input.supersededBySequence,
    ),
    pendingSupersededBySequence: nextPendingSupersededBySequence,
  };
}

export function applyHeadTurnCommitted(input: {
  assistantSummary: {
    currentObjective: string | null;
    latestHandsStatus: string | null;
    openQuestions: string[];
    summary: string;
    summaryUpdatedAt: string;
  };
  completedAt: string;
  conversationCursor: string | null;
  incrementEpisodeTurnCount: boolean;
  readThroughSequence: number | null;
  workingContext: WorkingContext;
}): WorkingContext {
  const processedSequence =
    input.readThroughSequence == null
      ? input.workingContext.latestProcessedSequence
      : Math.max(input.workingContext.latestProcessedSequence, input.readThroughSequence);
  const nextEpisodeTurnCount = input.incrementEpisodeTurnCount
    ? input.workingContext.episodeTurnCount + 1
    : input.workingContext.episodeTurnCount;

  return {
    ...input.workingContext,
    ...clearActiveHeadTurnClaim(input.workingContext, input.completedAt),
    latestInboundSequence:
      input.readThroughSequence == null
        ? input.workingContext.latestInboundSequence
        : Math.max(input.workingContext.latestInboundSequence, input.readThroughSequence),
    latestProcessedSequence: processedSequence,
    pendingSupersededBySequence:
      input.workingContext.pendingSupersededBySequence != null &&
      input.workingContext.pendingSupersededBySequence <= processedSequence
        ? null
        : input.workingContext.pendingSupersededBySequence,
    debounceUntil:
      input.workingContext.pendingDebounceSequence != null &&
      input.workingContext.pendingDebounceSequence <= processedSequence
        ? null
        : input.workingContext.debounceUntil,
    pendingDebounceSequence:
      input.workingContext.pendingDebounceSequence != null &&
      input.workingContext.pendingDebounceSequence <= processedSequence
        ? null
        : input.workingContext.pendingDebounceSequence,
    conversationCursor: input.conversationCursor ?? undefined,
    episodeTurnCount: nextEpisodeTurnCount,
    summary: input.assistantSummary.summary,
    summaryUpdatedAt: input.assistantSummary.summaryUpdatedAt,
    currentObjective: input.assistantSummary.currentObjective,
    latestHandsStatus: input.assistantSummary.latestHandsStatus,
    openQuestions: input.assistantSummary.openQuestions,
  };
}

export function clearHeadTurnClaim(input: {
  releasedAt: string;
  workingContext: WorkingContext;
}): WorkingContext {
  return {
    ...input.workingContext,
    ...clearActiveHeadTurnClaim(input.workingContext, input.releasedAt),
  };
}

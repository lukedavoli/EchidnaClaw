import {
  type Agent,
  type Approval,
  type AuditEvent,
  type Artifact,
  type Channel,
  type CorrelationMetadata,
  type CredentialRef,
  type HandsRun,
  type IdempotencyRecord,
  type InboundMessage,
  type OutboundMessage,
  type RunJournal,
  type RunJournalEntry,
  type SandboxSession,
  type Schedule,
  type Task,
  type TaskEnvelope,
  type UsageEvent,
  type WorkingContext,
} from '@echidna-claw/contracts';

export const FIXTURE_TIMESTAMP = '2026-04-12T00:00:00.000Z';

export function createCorrelationMetadata(
  overrides: Partial<CorrelationMetadata> = {},
): CorrelationMetadata {
  return {
    traceId: 'trc_persistence',
    idempotencyKey: 'idem_persistence',
    analyticsKey: 'anl_persistence',
    taskId: 'tsk_persistence',
    headTurnId: 'hdr_persistence',
    handsRunId: 'hnd_persistence',
    sandboxSessionId: 'sbx_persistence',
    inboundMessageId: 'inm_persistence',
    channelUpdateKey: 'upd_persistence',
    ...overrides,
  };
}

export function createAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agt_persistence',
    recordType: 'agent',
    schemaVersion: 1,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    correlation: createCorrelationMetadata(),
    name: 'Persistence Agent',
    timeZone: 'Australia/Sydney',
    headModel: 'gpt-5.4-mini',
    primaryChannelId: 'chn_persistence',
    provisioningState: 'active',
    lifecycleState: 'active',
    softDeletedAt: null,
    restoredAt: null,
    factoryProfileVersion: 'factory-v1',
    responsibilitiesSummary: 'Manages persistence test flows.',
    ...overrides,
  };
}

export function createChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'chn_persistence',
    recordType: 'channel',
    schemaVersion: 1,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    correlation: createCorrelationMetadata(),
    agentId: 'agt_persistence',
    provider: 'telegram',
    state: 'active',
    externalHandle: 'telegram-handle',
    externalChatId: 'chat-123',
    botUserId: 'telegram-bot-user',
    botDisplayName: 'Persistence Bot',
    credentialId: undefined,
    trustedExternalUserId: undefined,
    trustedExternalUserHandle: undefined,
    trustedExternalDisplayName: undefined,
    provisioningRequestedAt: FIXTURE_TIMESTAMP,
    provisioningStartedAt: '2026-04-12T00:01:00.000Z',
    boundAt: '2026-04-12T00:02:00.000Z',
    lastProvisioningFailedAt: null,
    lastProvisioningErrorCode: undefined,
    lastProvisioningErrorMessage: undefined,
    recoveryAttemptCount: 0,
    lastRecoveryRequestedAt: null,
    lastInboundSequence: 0,
    lastInboundReceivedAt: null,
    lastOutboundSentAt: null,
    lastInboundExternalMessageId: undefined,
    lastOutboundExternalMessageId: undefined,
    lastExternalMessageId: undefined,
    ...overrides,
  };
}

export function createInboundMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: 'inm_persistence',
    recordType: 'inbound_message',
    schemaVersion: 1,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    correlation: createCorrelationMetadata(),
    agentId: 'agt_persistence',
    channelId: 'chn_persistence',
    sequence: 1,
    kind: 'text',
    receivedAt: FIXTURE_TIMESTAMP,
    externalChatId: 'chat-123',
    externalMessageId: 'telegram-message-1',
    externalUpdateId: 'telegram-update-1',
    trusted: true,
    sender: {
      provider: 'telegram',
      externalUserId: 'user-123',
      externalUserHandle: 'persistence-user',
      displayName: 'Persistence User',
    },
    callbackData: undefined,
    unsupportedType: undefined,
    redacted: false,
    sensitiveInputKind: null,
    body: {
      text: 'Check on the scheduled deployment.',
      artifacts: [],
    },
    ...overrides,
  };
}

export function createOutboundMessage(overrides: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    id: 'out_persistence',
    recordType: 'outbound_message',
    schemaVersion: 1,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    correlation: createCorrelationMetadata(),
    agentId: 'agt_persistence',
    channelId: 'chn_persistence',
    inReplyToInboundMessageId: 'inm_persistence',
    deliveryState: 'queued',
    requestedAt: FIXTURE_TIMESTAMP,
    sentAt: null,
    failedAt: null,
    deliveredAt: null,
    externalMessageId: undefined,
    failureCode: undefined,
    failureMessage: undefined,
    actions: [],
    body: {
      text: 'Working on it.',
      artifacts: [],
    },
    ...overrides,
  };
}

export function createWorkingContext(overrides: Partial<WorkingContext> = {}): WorkingContext {
  return {
    id: 'ctx_persistence',
    recordType: 'working_context',
    schemaVersion: 1,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    correlation: createCorrelationMetadata(),
    agentId: 'agt_persistence',
    latestInboundSequence: 1,
    latestProcessedSequence: 1,
    activeHeadTurnId: null,
    activeHeadTurnStartedAt: null,
    activeHeadTurnReadThroughSequence: null,
    pendingSupersededBySequence: null,
    debounceUntil: null,
    pendingDebounceSequence: null,
    episodeLocalDate: '2026-04-12',
    episodeTurnCount: 1,
    activeTaskId: null,
    summary: 'Current operational summary.',
    summaryUpdatedAt: FIXTURE_TIMESTAMP,
    currentObjective: 'Confirm deployment health.',
    latestHandsStatus: null,
    openQuestions: [],
    conversationCursor: undefined,
    openTaskIds: [],
    pendingApprovalIds: [],
    pendingCredentialCaptureIds: [],
    ...overrides,
  };
}

export function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'tsk_persistence',
    recordType: 'task',
    schemaVersion: 1,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    correlation: createCorrelationMetadata(),
    agentId: 'agt_persistence',
    type: 'follow_up',
    state: 'queued',
    queue: {
      lane: 'user_requested',
      priority: 'normal',
    },
    requestedOutcome: 'Confirm deployment health.',
    requestedBy: {
      kind: 'user',
      sourceMessageId: 'inm_persistence',
    },
    dueAt: null,
    stateEnteredAt: FIXTURE_TIMESTAMP,
    scheduleId: undefined,
    activeTaskEnvelopeId: 'env_persistence',
    currentRunJournalId: 'rjn_persistence',
    currentHandsRunId: null,
    activeApprovalId: null,
    activeCredentialCaptureId: null,
    mergeKey: 'merge_agt-persistence-follow-up-user-confirm-deployment-health-immediate',
    mergedIntoTaskId: null,
    attemptCount: 1,
    launchState: {
      status: 'not_requested',
      requestedAt: null,
      lastAttemptAt: null,
      lastIdempotencyKey: null,
      attemptCount: 0,
    },
    cancellationRequestedAt: null,
    cancellationReason: null,
    lastCheckpointAt: null,
    progressSummary: {
      headline: 'Queued: Confirm deployment health.',
      waitingForUser: false,
      lastActor: 'head',
    },
    lastProgressAt: FIXTURE_TIMESTAMP,
    completedAt: null,
    failedAt: null,
    cancelledAt: null,
    artifactIds: [],
    externalReferences: [],
    notes: '',
    ...overrides,
  };
}

export function createTaskEnvelope(overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  return {
    id: 'env_persistence',
    recordType: 'task_envelope',
    schemaVersion: 1,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    correlation: createCorrelationMetadata(),
    taskId: 'tsk_persistence',
    agentId: 'agt_persistence',
    taskType: 'follow_up',
    requestedOutcome: 'Confirm deployment health.',
    requestedBy: {
      kind: 'user',
      sourceMessageId: 'inm_persistence',
    },
    queue: {
      lane: 'user_requested',
      priority: 'normal',
    },
    dueAt: null,
    sourceHeadTurnId: 'hdr_persistence',
    workingContextSummary: 'Current operational summary.',
    mergeKey: 'merge_agt-persistence-follow-up-user-confirm-deployment-health-immediate',
    attemptNumber: 1,
    supersedesEnvelopeId: null,
    dispatchIdempotencyKey: null,
    approvalState: undefined,
    artifactIds: [],
    credentialIds: [],
    externalReferences: [],
    notes: '',
    ...overrides,
  };
}

export function createApproval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: 'apr_persistence',
    recordType: 'approval',
    schemaVersion: 1,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    correlation: createCorrelationMetadata(),
    agentId: 'agt_persistence',
    taskId: 'tsk_persistence',
    state: 'requested',
    requestedAt: FIXTURE_TIMESTAMP,
    decidedAt: null,
    blocking: true,
    category: 'other',
    summary: 'Approve a deployment restart.',
    actionFingerprint: 'approval:restart',
    requestChannelId: null,
    requestMessageId: null,
    taskEnvelopeId: null,
    runJournalId: null,
    decisionInboundMessageId: null,
    decisionChannelId: null,
    decisionSource: null,
    stepUpRequired: false,
    decisionReason: '',
    expiresAt: null,
    ...overrides,
  };
}

export function createSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 'sch_persistence',
    recordType: 'schedule',
    schemaVersion: 1,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    correlation: createCorrelationMetadata(),
    agentId: 'agt_persistence',
    state: 'active',
    description: 'Daily deployment check',
    naturalLanguageRequest: 'Check deployments every day at 9am.',
    recurrence: {
      frequency: 'daily',
      interval: 1,
      timeZone: 'Australia/Sydney',
      anchorAt: FIXTURE_TIMESTAMP,
      localTime: '09:00',
    },
    nextDueAt: FIXTURE_TIMESTAMP,
    lastMaterializedOccurrenceAt: null,
    skipMissedOccurrencesOnRestore: true,
    ...overrides,
  };
}

export function createArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'art_persistence',
    recordType: 'artifact',
    schemaVersion: 1,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    correlation: createCorrelationMetadata(),
    agentId: 'agt_persistence',
    storageKind: 'blob',
    blobPath: '',
    contentType: 'text/plain',
    sizeBytes: 0,
    retentionUntil: null,
    ...overrides,
  };
}

export function createCredentialRef(overrides: Partial<CredentialRef> = {}): CredentialRef {
  return {
    id: 'crd_persistence',
    recordType: 'credential_ref',
    schemaVersion: 1,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    correlation: createCorrelationMetadata(),
    agentId: 'agt_persistence',
    provider: 'google',
    alias: 'primary-google',
    scope: 'agent',
    status: 'active',
    accessPolicyRef: 'kv/credentials/google',
    encryptionKeyRef: 'kv/keys/credential-encryption',
    lastRotatedAt: null,
    lastUsedAt: null,
    revokedAt: null,
    replacedByCredentialId: null,
    expiresAt: null,
    ...overrides,
  };
}

export function createIdempotencyRecord(
  overrides: Partial<IdempotencyRecord> = {},
): IdempotencyRecord {
  return {
    id: 'idr_persistence',
    recordType: 'idempotency_record',
    schemaVersion: 1,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    correlation: createCorrelationMetadata(),
    agentId: 'agt_persistence',
    scope: 'telegram:webhook',
    key: 'telegram-update-1',
    status: 'completed',
    resultReference: 'inm_persistence',
    expiresAt: '2026-04-19T00:00:00.000Z',
    ...overrides,
  };
}

export function createRunJournal(overrides: Partial<RunJournal> = {}): RunJournal {
  return {
    id: 'rjn_persistence',
    recordType: 'run_journal',
    schemaVersion: 1,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    correlation: createCorrelationMetadata(),
    agentId: 'agt_persistence',
    scope: 'hands_run',
    scopeId: 'hnd_persistence',
    taskId: 'tsk_persistence',
    handsRunId: 'hnd_persistence',
    status: 'open',
    openedAt: FIXTURE_TIMESTAMP,
    closedAt: null,
    summary: '',
    progressSummary: {
      headline: 'Queued: Confirm deployment health.',
      waitingForUser: false,
      lastActor: 'head',
    },
    lastEntryAt: FIXTURE_TIMESTAMP,
    resultCode: null,
    ...overrides,
  };
}

export function createRunJournalEntry(overrides: Partial<RunJournalEntry> = {}): RunJournalEntry {
  return {
    id: 'rje_persistence',
    recordType: 'run_journal_entry',
    schemaVersion: 1,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    correlation: createCorrelationMetadata(),
    journalId: 'rjn_persistence',
    agentId: 'agt_persistence',
    entryKind: 'status',
    level: 'info',
    recordedAt: FIXTURE_TIMESTAMP,
    message: 'Started work.',
    taskStateAfter: 'queued',
    progressSummaryPatch: {
      headline: 'Queued: Confirm deployment health.',
      waitingForUser: false,
      lastActor: 'head',
    },
    artifactIds: [],
    approvalId: null,
    handsActionSummary: undefined,
    ...overrides,
  };
}

export function createHandsRun(overrides: Partial<HandsRun> = {}): HandsRun {
  return {
    id: 'hnd_persistence',
    recordType: 'hands_run',
    schemaVersion: 1,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    correlation: createCorrelationMetadata(),
    agentId: 'agt_persistence',
    taskId: 'tsk_persistence',
    taskEnvelopeId: 'env_persistence',
    dispatchIdempotencyKey: 'idem_hands-dispatch',
    attemptNumber: 1,
    state: 'queued',
    claimedAt: FIXTURE_TIMESTAMP,
    lastHeartbeatAt: FIXTURE_TIMESTAMP,
    workerInstanceId: 'hands-worker-test',
    cancellationRequestedAt: null,
    cancelledAt: null,
    resultCode: null,
    failureCode: null,
    failureMessage: null,
    startedAt: null,
    completedAt: null,
    releasedAt: null,
    ...overrides,
  };
}

export function createSandboxSession(overrides: Partial<SandboxSession> = {}): SandboxSession {
  return {
    id: 'sbx_persistence',
    recordType: 'sandbox_session',
    schemaVersion: 1,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    correlation: createCorrelationMetadata(),
    agentId: 'agt_persistence',
    handsRunId: 'hnd_persistence',
    taskId: 'tsk_persistence',
    state: 'created',
    policyName: 'standard',
    workspaceRoot: 'C:/tmp/echidna-claw/sbx_persistence',
    workingDirectory: 'C:/tmp/echidna-claw/sbx_persistence/work',
    resourceProfile: {
      defaultTimeoutMs: 10000,
      maxTimeoutMs: 60000,
      maxOutputBytes: 32768,
      maxMemoryMb: 1024,
      maxCpuSeconds: 30,
    },
    packageAllowlistName: 'default-runtime-pnpm',
    credentialBindings: [],
    credentialAliases: [],
    commandCount: 0,
    lastCommandStartedAt: null,
    lastCommandCompletedAt: null,
    closedReason: null,
    failureCode: null,
    allowedOutboundHosts: ['api.telegram.org'],
    startedAt: FIXTURE_TIMESTAMP,
    completedAt: null,
    ...overrides,
  };
}

export function createUsageEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    id: 'use_persistence',
    recordType: 'usage_event',
    schemaVersion: 1,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    correlation: createCorrelationMetadata(),
    agentId: 'agt_persistence',
    source: 'hands',
    provider: 'azure-foundry',
    model: 'gpt-5.4-mini',
    operation: 'run-task',
    occurredAt: FIXTURE_TIMESTAMP,
    providerOperationId: 'provop_persistence',
    analyticsGroup: 'hands-run',
    tokens: {
      inputTokens: 120,
      outputTokens: 45,
      reasoningTokens: null,
      toolInputTokens: null,
      toolOutputTokens: null,
    },
    estimatedCostUsd: 0.0123,
    pricingStatus: 'estimated',
    ...overrides,
  };
}

export function createAuditEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'aud_persistence',
    recordType: 'audit_event',
    schemaVersion: 1,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    correlation: createCorrelationMetadata(),
    agentId: 'agt_persistence',
    occurredAt: FIXTURE_TIMESTAMP,
    retentionUntil: '2026-05-12T00:00:00.000Z',
    category: 'run_outcome',
    action: 'hands.completed',
    outcome: 'succeeded',
    summary: 'Hands completed the queued work.',
    attributes: {
      taskId: 'tsk_persistence',
    },
    artifactIds: [],
    ...overrides,
  };
}

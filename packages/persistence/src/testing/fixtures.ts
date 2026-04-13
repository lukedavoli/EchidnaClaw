import {
  type Agent,
  type Approval,
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
    provisioningRequestedAt: FIXTURE_TIMESTAMP,
    provisioningStartedAt: '2026-04-12T00:01:00.000Z',
    boundAt: '2026-04-12T00:02:00.000Z',
    lastProvisioningFailedAt: null,
    lastProvisioningErrorCode: undefined,
    lastProvisioningErrorMessage: undefined,
    recoveryAttemptCount: 0,
    lastRecoveryRequestedAt: null,
    lastInboundSequence: 0,
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
    receivedAt: FIXTURE_TIMESTAMP,
    externalMessageId: 'telegram-message-1',
    externalUpdateId: 'telegram-update-1',
    trusted: true,
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
    deliveredAt: null,
    externalMessageId: undefined,
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
    lastTrustedMessageSequence: 1,
    activeHeadTurnId: null,
    activeTaskId: null,
    summary: 'Current operational summary.',
    conversationCursor: undefined,
    openTaskIds: [],
    pendingApprovalIds: [],
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
    currentHandsRunId: null,
    activeApprovalId: null,
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
    queue: {
      priority: 'normal',
    },
    dueAt: null,
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
    summary: 'Approve a deployment restart.',
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
    revokedAt: null,
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
    status: 'open',
    openedAt: FIXTURE_TIMESTAMP,
    closedAt: null,
    summary: '',
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
    level: 'info',
    recordedAt: FIXTURE_TIMESTAMP,
    message: 'Started work.',
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
    state: 'queued',
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
    workingDirectory: 'C:/tmp/echidna-claw',
    allowedOutboundHosts: ['api.telegram.org'],
    startedAt: null,
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
    model: 'gpt-5.4-mini',
    operation: 'run-task',
    occurredAt: FIXTURE_TIMESTAMP,
    tokens: {
      inputTokens: 120,
      outputTokens: 45,
    },
    estimatedCostUsd: 0.0123,
    ...overrides,
  };
}

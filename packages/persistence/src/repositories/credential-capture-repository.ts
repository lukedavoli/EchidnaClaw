import {
  credentialCaptureSchema,
  runJournalEntrySchema,
  runJournalSchema,
  taskSchema,
  type AgentId,
  type CredentialCapture,
  type CredentialCaptureId,
  type RunJournal,
  type RunJournalEntry,
  type Task,
  type WorkingContext,
  workingContextSchema,
} from '@echidna-claw/contracts';

import { type StoredRecord } from '../documents/envelope.js';
import { assertSameAgent, eq, operationalContainerName } from './common.js';
import { type BatchOperation, type PersistedRecordStore } from './store.js';

export interface CredentialCaptureLifecycleMutationResult {
  credentialCapture: StoredRecord<CredentialCapture>;
  runJournal: StoredRecord<RunJournal> | null;
  runJournalEntry: StoredRecord<RunJournalEntry> | null;
  task: StoredRecord<Task> | null;
  workingContext: StoredRecord<WorkingContext> | null;
}

export interface CredentialCaptureRepository {
  create(capture: CredentialCapture): Promise<StoredRecord<CredentialCapture>>;
  get(
    agentId: AgentId,
    credentialCaptureId: CredentialCaptureId,
  ): Promise<StoredRecord<CredentialCapture> | null>;
  findById(credentialCaptureId: CredentialCaptureId): Promise<StoredRecord<CredentialCapture> | null>;
  findPendingByAgent(agentId: AgentId): Promise<StoredRecord<CredentialCapture> | null>;
  listPending(agentId?: AgentId): Promise<StoredRecord<CredentialCapture>[]>;
  replace(
    capture: CredentialCapture,
    expectedEtag: string,
  ): Promise<StoredRecord<CredentialCapture>>;
  createBlockingRequest(input: {
    credentialCapture: CredentialCapture;
    runJournal?: RunJournal;
    runJournalEtag?: string;
    runJournalEntry?: RunJournalEntry;
    task?: Task;
    taskEtag?: string;
    workingContext?: WorkingContext;
    workingContextEtag?: string;
  }): Promise<CredentialCaptureLifecycleMutationResult>;
  finalizeCapture(input: {
    credentialCapture: CredentialCapture;
    credentialCaptureEtag: string;
    runJournal?: RunJournal;
    runJournalEtag?: string;
    runJournalEntry?: RunJournalEntry;
    task?: Task;
    taskEtag?: string;
    workingContext?: WorkingContext;
    workingContextEtag?: string;
  }): Promise<CredentialCaptureLifecycleMutationResult>;
}

export class DefaultCredentialCaptureRepository implements CredentialCaptureRepository {
  constructor(private readonly store: PersistedRecordStore) {}

  async create(capture: CredentialCapture): Promise<StoredRecord<CredentialCapture>> {
    return this.store.create(credentialCaptureSchema.parse(capture));
  }

  async get(
    agentId: AgentId,
    credentialCaptureId: CredentialCaptureId,
  ): Promise<StoredRecord<CredentialCapture> | null> {
    return this.store.get(credentialCaptureId, agentId, credentialCaptureSchema);
  }

  async findById(
    credentialCaptureId: CredentialCaptureId,
  ): Promise<StoredRecord<CredentialCapture> | null> {
    const results = await this.store.query({
      containerName: operationalContainerName,
      schema: credentialCaptureSchema,
      where: [eq('recordType', 'credential_capture'), eq('id', credentialCaptureId)],
      limit: 1,
    });

    return results[0] ?? null;
  }

  async findPendingByAgent(agentId: AgentId): Promise<StoredRecord<CredentialCapture> | null> {
    const results = await this.store.query({
      containerName: operationalContainerName,
      partitionKey: agentId,
      schema: credentialCaptureSchema,
      where: [eq('recordType', 'credential_capture'), eq('state', 'requested')],
      orderBy: [{ field: 'requestedAt', direction: 'asc' }],
      limit: 1,
    });

    return results[0] ?? null;
  }

  async listPending(agentId?: AgentId): Promise<StoredRecord<CredentialCapture>[]> {
    return this.store.query({
      containerName: operationalContainerName,
      ...(agentId ? { partitionKey: agentId } : {}),
      schema: credentialCaptureSchema,
      where: [eq('recordType', 'credential_capture'), eq('state', 'requested')],
      orderBy: [{ field: 'requestedAt', direction: 'asc' }],
    });
  }

  async replace(
    capture: CredentialCapture,
    expectedEtag: string,
  ): Promise<StoredRecord<CredentialCapture>> {
    return this.store.replace(credentialCaptureSchema.parse(capture), expectedEtag);
  }

  async createBlockingRequest(input: {
    credentialCapture: CredentialCapture;
    runJournal?: RunJournal;
    runJournalEtag?: string;
    runJournalEntry?: RunJournalEntry;
    task?: Task;
    taskEtag?: string;
    workingContext?: WorkingContext;
    workingContextEtag?: string;
  }): Promise<CredentialCaptureLifecycleMutationResult> {
    const credentialCapture = credentialCaptureSchema.parse(input.credentialCapture);
    const task = input.task ? taskSchema.parse(input.task) : undefined;
    const workingContext = input.workingContext
      ? workingContextSchema.parse(input.workingContext)
      : undefined;
    const runJournal = input.runJournal ? runJournalSchema.parse(input.runJournal) : undefined;
    const runJournalEntry = input.runJournalEntry
      ? runJournalEntrySchema.parse(input.runJournalEntry)
      : undefined;
    assertSameAgent(credentialCapture.agentId, [
      credentialCapture,
      ...(task ? [task] : []),
      ...(workingContext ? [workingContext] : []),
      ...(runJournal ? [runJournal] : []),
      ...(runJournalEntry ? [runJournalEntry] : []),
    ]);

    if ((task == null) !== (input.taskEtag == null)) {
      throw new Error('task and taskEtag must be provided together.');
    }

    if ((workingContext == null) !== (input.workingContextEtag == null)) {
      throw new Error('workingContext and workingContextEtag must be provided together.');
    }

    const operations: BatchOperation[] = [
      ...(workingContext && input.workingContextEtag
        ? [
            {
              kind: 'replace' as const,
              record: workingContext,
              expectedEtag: input.workingContextEtag,
            },
          ]
        : []),
      ...(task && input.taskEtag
        ? [
            {
              kind: 'replace' as const,
              record: task,
              expectedEtag: input.taskEtag,
            },
          ]
        : []),
      {
        kind: 'create',
        record: credentialCapture,
      },
      ...(runJournal
        ? [
            input.runJournalEtag
              ? {
                  kind: 'replace' as const,
                  record: runJournal,
                  expectedEtag: input.runJournalEtag,
                }
              : {
                  kind: 'create' as const,
                  record: runJournal,
                },
          ]
        : []),
      ...(runJournalEntry
        ? [
            {
              kind: 'create' as const,
              record: runJournalEntry,
            },
          ]
        : []),
    ];
    const results = await this.store.batch(credentialCapture.agentId, operations);
    const offset = (workingContext ? 1 : 0) + (task ? 1 : 0);

    return {
      workingContext: workingContext ? (results[0] as StoredRecord<WorkingContext>) : null,
      task:
        task && workingContext
          ? (results[1] as StoredRecord<Task>)
          : task
            ? (results[0] as StoredRecord<Task>)
            : null,
      credentialCapture: results[offset] as StoredRecord<CredentialCapture>,
      runJournal: runJournal ? (results[offset + 1] as StoredRecord<RunJournal>) : null,
      runJournalEntry: runJournalEntry
        ? (results[offset + (runJournal ? 2 : 1)] as StoredRecord<RunJournalEntry>)
        : null,
    };
  }

  async finalizeCapture(input: {
    credentialCapture: CredentialCapture;
    credentialCaptureEtag: string;
    runJournal?: RunJournal;
    runJournalEtag?: string;
    runJournalEntry?: RunJournalEntry;
    task?: Task;
    taskEtag?: string;
    workingContext?: WorkingContext;
    workingContextEtag?: string;
  }): Promise<CredentialCaptureLifecycleMutationResult> {
    const credentialCapture = credentialCaptureSchema.parse(input.credentialCapture);
    const task = input.task ? taskSchema.parse(input.task) : undefined;
    const workingContext = input.workingContext
      ? workingContextSchema.parse(input.workingContext)
      : undefined;
    const runJournal = input.runJournal ? runJournalSchema.parse(input.runJournal) : undefined;
    const runJournalEntry = input.runJournalEntry
      ? runJournalEntrySchema.parse(input.runJournalEntry)
      : undefined;
    assertSameAgent(credentialCapture.agentId, [
      credentialCapture,
      ...(task ? [task] : []),
      ...(workingContext ? [workingContext] : []),
      ...(runJournal ? [runJournal] : []),
      ...(runJournalEntry ? [runJournalEntry] : []),
    ]);

    if ((task == null) !== (input.taskEtag == null)) {
      throw new Error('task and taskEtag must be provided together.');
    }

    if ((workingContext == null) !== (input.workingContextEtag == null)) {
      throw new Error('workingContext and workingContextEtag must be provided together.');
    }

    const operations: BatchOperation[] = [
      ...(workingContext && input.workingContextEtag
        ? [
            {
              kind: 'replace' as const,
              record: workingContext,
              expectedEtag: input.workingContextEtag,
            },
          ]
        : []),
      ...(task && input.taskEtag
        ? [
            {
              kind: 'replace' as const,
              record: task,
              expectedEtag: input.taskEtag,
            },
          ]
        : []),
      {
        kind: 'replace',
        record: credentialCapture,
        expectedEtag: input.credentialCaptureEtag,
      },
      ...(runJournal && input.runJournalEtag
        ? [
            {
              kind: 'replace' as const,
              record: runJournal,
              expectedEtag: input.runJournalEtag,
            },
          ]
        : []),
      ...(runJournalEntry
        ? [
            {
              kind: 'create' as const,
              record: runJournalEntry,
            },
          ]
        : []),
    ];
    const results = await this.store.batch(credentialCapture.agentId, operations);
    const offset = (workingContext ? 1 : 0) + (task ? 1 : 0);

    return {
      workingContext: workingContext ? (results[0] as StoredRecord<WorkingContext>) : null,
      task:
        task && workingContext
          ? (results[1] as StoredRecord<Task>)
          : task
            ? (results[0] as StoredRecord<Task>)
            : null,
      credentialCapture: results[offset] as StoredRecord<CredentialCapture>,
      runJournal: runJournal && input.runJournalEtag ? (results[offset + 1] as StoredRecord<RunJournal>) : null,
      runJournalEntry: runJournalEntry
        ? (results[offset + (runJournal && input.runJournalEtag ? 2 : 1)] as StoredRecord<RunJournalEntry>)
        : null,
    };
  }
}

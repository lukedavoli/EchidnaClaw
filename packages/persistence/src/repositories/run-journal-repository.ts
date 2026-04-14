import {
  runJournalEntrySchema,
  runJournalSchema,
  taskSchema,
  type AgentId,
  type RunJournal,
  type RunJournalEntry,
  type RunJournalEntryId,
  type RunJournalId,
  type Task,
  type TaskId,
} from '@echidna-claw/contracts';

import { type StoredRecord } from '../documents/envelope.js';
import { assertSameAgent } from './common.js';
import { eq, operationalContainerName } from './common.js';
import { type PersistedRecordStore } from './store.js';

export interface AppendJournalEntryResult {
  entry: StoredRecord<RunJournalEntry>;
  journal: StoredRecord<RunJournal>;
  task?: StoredRecord<Task>;
}

export interface RunJournalRepository {
  openJournal(journal: RunJournal): Promise<StoredRecord<RunJournal>>;
  getJournal(agentId: AgentId, journalId: RunJournalId): Promise<StoredRecord<RunJournal> | null>;
  replaceJournal(journal: RunJournal, expectedEtag: string): Promise<StoredRecord<RunJournal>>;
  getLatestJournalForTask(agentId: AgentId, taskId: TaskId): Promise<StoredRecord<RunJournal> | null>;
  appendEntry(entry: RunJournalEntry): Promise<StoredRecord<RunJournalEntry>>;
  appendEntryAndUpdateJournal(input: {
    entry: RunJournalEntry;
    journal: RunJournal;
    journalEtag: string;
    task?: Task;
    taskEtag?: string;
  }): Promise<AppendJournalEntryResult>;
  getEntry(agentId: AgentId, entryId: RunJournalEntryId): Promise<StoredRecord<RunJournalEntry> | null>;
  listEntries(agentId: AgentId, journalId: RunJournalId, limit?: number): Promise<StoredRecord<RunJournalEntry>[]>;
}

export class DefaultRunJournalRepository implements RunJournalRepository {
  constructor(private readonly store: PersistedRecordStore) {}

  async openJournal(journal: RunJournal): Promise<StoredRecord<RunJournal>> {
    return this.store.create(runJournalSchema.parse(journal));
  }

  async getJournal(
    agentId: AgentId,
    journalId: RunJournalId,
  ): Promise<StoredRecord<RunJournal> | null> {
    return this.store.get(journalId, agentId, runJournalSchema);
  }

  async replaceJournal(journal: RunJournal, expectedEtag: string): Promise<StoredRecord<RunJournal>> {
    return this.store.replace(runJournalSchema.parse(journal), expectedEtag);
  }

  async getLatestJournalForTask(
    agentId: AgentId,
    taskId: TaskId,
  ): Promise<StoredRecord<RunJournal> | null> {
    const results = await this.store.query({
      containerName: operationalContainerName,
      partitionKey: agentId,
      schema: runJournalSchema,
      where: [eq('recordType', 'run_journal'), eq('taskId', taskId)],
      orderBy: [{ field: 'openedAt', direction: 'desc' }],
      limit: 1,
    });

    return results[0] ?? null;
  }

  async appendEntry(entry: RunJournalEntry): Promise<StoredRecord<RunJournalEntry>> {
    return this.store.create(runJournalEntrySchema.parse(entry));
  }

  async appendEntryAndUpdateJournal(input: {
    entry: RunJournalEntry;
    journal: RunJournal;
    journalEtag: string;
    task?: Task;
    taskEtag?: string;
  }): Promise<AppendJournalEntryResult> {
    const entry = runJournalEntrySchema.parse(input.entry);
    const journal = runJournalSchema.parse(input.journal);
    const task = input.task ? taskSchema.parse(input.task) : undefined;
    assertSameAgent(journal.agentId, [journal, entry, ...(task ? [task] : [])]);

    const operations = [
      {
        kind: 'replace' as const,
        record: journal,
        expectedEtag: input.journalEtag,
      },
      {
        kind: 'create' as const,
        record: entry,
      },
      ...(task && input.taskEtag
        ? [
            {
              kind: 'replace' as const,
              record: task,
              expectedEtag: input.taskEtag,
            },
          ]
        : []),
    ];
    const results = await this.store.batch(journal.agentId, operations);

    return {
      journal: results[0] as StoredRecord<RunJournal>,
      entry: results[1] as StoredRecord<RunJournalEntry>,
      ...(task && input.taskEtag
        ? {
            task: results[2] as StoredRecord<Task>,
          }
        : {}),
    };
  }

  async getEntry(
    agentId: AgentId,
    entryId: RunJournalEntryId,
  ): Promise<StoredRecord<RunJournalEntry> | null> {
    return this.store.get(entryId, agentId, runJournalEntrySchema);
  }

  async listEntries(
    agentId: AgentId,
    journalId: RunJournalId,
    limit = 200,
  ): Promise<StoredRecord<RunJournalEntry>[]> {
    return this.store.query({
      containerName: operationalContainerName,
      partitionKey: agentId,
      schema: runJournalEntrySchema,
      where: [eq('recordType', 'run_journal_entry'), eq('journalId', journalId)],
      orderBy: [{ field: 'recordedAt', direction: 'asc' }],
      limit,
    });
  }
}

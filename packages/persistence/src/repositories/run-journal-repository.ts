import {
  runJournalEntrySchema,
  runJournalSchema,
  type AgentId,
  type RunJournal,
  type RunJournalEntry,
  type RunJournalEntryId,
  type RunJournalId,
} from '@echidna-claw/contracts';

import { type StoredRecord } from '../documents/envelope.js';
import { eq, operationalContainerName } from './common.js';
import { type PersistedRecordStore } from './store.js';

export interface RunJournalRepository {
  openJournal(journal: RunJournal): Promise<StoredRecord<RunJournal>>;
  getJournal(agentId: AgentId, journalId: RunJournalId): Promise<StoredRecord<RunJournal> | null>;
  replaceJournal(journal: RunJournal, expectedEtag: string): Promise<StoredRecord<RunJournal>>;
  appendEntry(entry: RunJournalEntry): Promise<StoredRecord<RunJournalEntry>>;
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

  async appendEntry(entry: RunJournalEntry): Promise<StoredRecord<RunJournalEntry>> {
    return this.store.create(runJournalEntrySchema.parse(entry));
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

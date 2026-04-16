import {
  handsRunSchema,
  headTurnSchema,
  runJournalEntrySchema,
  runJournalSchema,
  sandboxSessionSchema,
  taskSchema,
  type AgentId,
  type HandsRun,
  type HandsRunId,
  type RunJournal,
  type RunJournalEntry,
  type HeadTurn,
  type HeadTurnId,
  type SandboxSession,
  type SandboxSessionId,
  type Task,
  type WorkingContext,
  workingContextSchema,
} from '@echidna-claw/contracts';

import { type StoredRecord } from '../documents/envelope.js';
import {
  ACTIVE_HANDS_RUN_STATES,
  ACTIVE_HEAD_TURN_STATES,
  assertSameAgent,
  eq,
  inList,
  operationalContainerName,
} from './common.js';
import { type PersistedRecordStore } from './store.js';

export interface HandsRunClaimResult {
  handsRun: StoredRecord<HandsRun>;
  task: StoredRecord<Task>;
}

export interface HeadTurnClaimResult {
  headTurn: StoredRecord<HeadTurn>;
  workingContext: StoredRecord<WorkingContext>;
}

export interface HandsRunExecutionGraphResult {
  handsRun: StoredRecord<HandsRun>;
  runJournal: StoredRecord<RunJournal>;
  runJournalEntry?: StoredRecord<RunJournalEntry>;
  task: StoredRecord<Task>;
  workingContext: StoredRecord<WorkingContext>;
}

export interface ExecutionRepository {
  createHeadTurn(headTurn: HeadTurn): Promise<StoredRecord<HeadTurn>>;
  findHeadTurn(headTurnId: HeadTurnId): Promise<StoredRecord<HeadTurn> | null>;
  getHeadTurn(agentId: AgentId, headTurnId: HeadTurnId): Promise<StoredRecord<HeadTurn> | null>;
  listActiveHeadTurns(agentId: AgentId): Promise<StoredRecord<HeadTurn>[]>;
  replaceHeadTurn(headTurn: HeadTurn, expectedEtag: string): Promise<StoredRecord<HeadTurn>>;
  claimHeadTurn(input: {
    headTurn: HeadTurn;
    workingContext: WorkingContext;
    workingContextEtag: string;
  }): Promise<HeadTurnClaimResult>;
  finalizeHeadTurn(input: {
    headTurn: HeadTurn;
    headTurnEtag: string;
    workingContext: WorkingContext;
    workingContextEtag: string;
  }): Promise<HeadTurnClaimResult>;
  supersedeHeadTurn(input: {
    headTurn: HeadTurn;
    headTurnEtag: string;
    workingContext?: WorkingContext;
    workingContextEtag?: string;
  }): Promise<HeadTurnClaimResult | { headTurn: StoredRecord<HeadTurn>; workingContext: null }>;
  createHandsRun(handsRun: HandsRun): Promise<StoredRecord<HandsRun>>;
  findHandsRun(handsRunId: HandsRunId): Promise<StoredRecord<HandsRun> | null>;
  findHandsRunByDispatchKey(
    agentId: AgentId,
    dispatchIdempotencyKey: string,
  ): Promise<StoredRecord<HandsRun> | null>;
  getHandsRun(agentId: AgentId, handsRunId: HandsRunId): Promise<StoredRecord<HandsRun> | null>;
  listActiveHandsRuns(agentId: AgentId): Promise<StoredRecord<HandsRun>[]>;
  replaceHandsRun(handsRun: HandsRun, expectedEtag: string): Promise<StoredRecord<HandsRun>>;
  claimTaskForHandsRun(input: {
    handsRun: HandsRun;
    runJournal: RunJournal;
    runJournalEntry: RunJournalEntry;
    task: Task;
    taskEtag: string;
    workingContext: WorkingContext;
    workingContextEtag: string;
  }): Promise<HandsRunExecutionGraphResult>;
  claimHandsRun(input: {
    handsRun: HandsRun;
    task: Task;
    taskEtag: string;
  }): Promise<HandsRunClaimResult>;
  updateHandsRunExecution(input: {
    handsRun: HandsRun;
    handsRunEtag: string;
    runJournal: RunJournal;
    runJournalEtag: string;
    runJournalEntry?: RunJournalEntry;
    task: Task;
    taskEtag: string;
    workingContext: WorkingContext;
    workingContextEtag: string;
  }): Promise<HandsRunExecutionGraphResult>;
  releaseHandsRun(input: {
    handsRun: HandsRun;
    handsRunEtag: string;
    task: Task;
    taskEtag: string;
  }): Promise<HandsRunClaimResult>;
  createSandboxSession(session: SandboxSession): Promise<StoredRecord<SandboxSession>>;
  findSandboxSession(sandboxSessionId: SandboxSessionId): Promise<StoredRecord<SandboxSession> | null>;
  getSandboxSession(
    agentId: AgentId,
    sandboxSessionId: SandboxSessionId,
  ): Promise<StoredRecord<SandboxSession> | null>;
  listActiveSandboxSessions(agentId: AgentId): Promise<StoredRecord<SandboxSession>[]>;
  replaceSandboxSession(
    session: SandboxSession,
    expectedEtag: string,
  ): Promise<StoredRecord<SandboxSession>>;
}

export class DefaultExecutionRepository implements ExecutionRepository {
  constructor(private readonly store: PersistedRecordStore) {}

  async createHeadTurn(headTurn: HeadTurn): Promise<StoredRecord<HeadTurn>> {
    return this.store.create(headTurnSchema.parse(headTurn));
  }

  async findHeadTurn(headTurnId: HeadTurnId): Promise<StoredRecord<HeadTurn> | null> {
    const results = await this.store.query({
      containerName: operationalContainerName,
      schema: headTurnSchema,
      where: [eq('recordType', 'head_turn'), eq('id', headTurnId)],
      limit: 1,
    });

    return results[0] ?? null;
  }

  async getHeadTurn(
    agentId: AgentId,
    headTurnId: HeadTurnId,
  ): Promise<StoredRecord<HeadTurn> | null> {
    return this.store.get(headTurnId, agentId, headTurnSchema);
  }

  async listActiveHeadTurns(agentId: AgentId): Promise<StoredRecord<HeadTurn>[]> {
    return this.store.query({
      containerName: operationalContainerName,
      partitionKey: agentId,
      schema: headTurnSchema,
      where: [eq('recordType', 'head_turn'), inList('state', [...ACTIVE_HEAD_TURN_STATES])],
      orderBy: [{ field: 'createdAt', direction: 'asc' }],
    });
  }

  async replaceHeadTurn(headTurn: HeadTurn, expectedEtag: string): Promise<StoredRecord<HeadTurn>> {
    return this.store.replace(headTurnSchema.parse(headTurn), expectedEtag);
  }

  async claimHeadTurn(input: {
    headTurn: HeadTurn;
    workingContext: WorkingContext;
    workingContextEtag: string;
  }): Promise<HeadTurnClaimResult> {
    const headTurn = headTurnSchema.parse(input.headTurn);
    const workingContext = workingContextSchema.parse(input.workingContext);
    assertSameAgent(headTurn.agentId, [headTurn, workingContext]);

    const [storedWorkingContext, storedHeadTurn] = await this.store.batch(headTurn.agentId, [
      {
        kind: 'replace',
        record: workingContext,
        expectedEtag: input.workingContextEtag,
      },
      {
        kind: 'create',
        record: headTurn,
      },
    ]);

    return {
      headTurn: storedHeadTurn as StoredRecord<HeadTurn>,
      workingContext: storedWorkingContext as StoredRecord<WorkingContext>,
    };
  }

  async finalizeHeadTurn(input: {
    headTurn: HeadTurn;
    headTurnEtag: string;
    workingContext: WorkingContext;
    workingContextEtag: string;
  }): Promise<HeadTurnClaimResult> {
    const headTurn = headTurnSchema.parse(input.headTurn);
    const workingContext = workingContextSchema.parse(input.workingContext);
    assertSameAgent(headTurn.agentId, [headTurn, workingContext]);

    const [storedWorkingContext, storedHeadTurn] = await this.store.batch(headTurn.agentId, [
      {
        kind: 'replace',
        record: workingContext,
        expectedEtag: input.workingContextEtag,
      },
      {
        kind: 'replace',
        record: headTurn,
        expectedEtag: input.headTurnEtag,
      },
    ]);

    return {
      headTurn: storedHeadTurn as StoredRecord<HeadTurn>,
      workingContext: storedWorkingContext as StoredRecord<WorkingContext>,
    };
  }

  async supersedeHeadTurn(input: {
    headTurn: HeadTurn;
    headTurnEtag: string;
    workingContext?: WorkingContext;
    workingContextEtag?: string;
  }): Promise<HeadTurnClaimResult | { headTurn: StoredRecord<HeadTurn>; workingContext: null }> {
    const headTurn = headTurnSchema.parse(input.headTurn);

    if (input.workingContext == null) {
      return {
        headTurn: await this.store.replace(headTurn, input.headTurnEtag),
        workingContext: null,
      };
    }

    if (input.workingContextEtag == null) {
      throw new Error('workingContextEtag is required when superseding a working context.');
    }

    const workingContext = workingContextSchema.parse(input.workingContext);
    assertSameAgent(headTurn.agentId, [headTurn, workingContext]);

    const [storedWorkingContext, storedHeadTurn] = await this.store.batch(headTurn.agentId, [
      {
        kind: 'replace',
        record: workingContext,
        expectedEtag: input.workingContextEtag,
      },
      {
        kind: 'replace',
        record: headTurn,
        expectedEtag: input.headTurnEtag,
      },
    ]);

    return {
      headTurn: storedHeadTurn as StoredRecord<HeadTurn>,
      workingContext: storedWorkingContext as StoredRecord<WorkingContext>,
    };
  }

  async createHandsRun(handsRun: HandsRun): Promise<StoredRecord<HandsRun>> {
    return this.store.create(handsRunSchema.parse(handsRun));
  }

  async findHandsRun(handsRunId: HandsRunId): Promise<StoredRecord<HandsRun> | null> {
    const results = await this.store.query({
      containerName: operationalContainerName,
      schema: handsRunSchema,
      where: [eq('recordType', 'hands_run'), eq('id', handsRunId)],
      limit: 1,
    });

    return results[0] ?? null;
  }

  async findHandsRunByDispatchKey(
    agentId: AgentId,
    dispatchIdempotencyKey: string,
  ): Promise<StoredRecord<HandsRun> | null> {
    const results = await this.store.query({
      containerName: operationalContainerName,
      partitionKey: agentId,
      schema: handsRunSchema,
      where: [
        eq('recordType', 'hands_run'),
        eq('dispatchIdempotencyKey', dispatchIdempotencyKey),
      ],
      orderBy: [{ field: 'createdAt', direction: 'desc' }],
      limit: 1,
    });

    return results[0] ?? null;
  }

  async getHandsRun(
    agentId: AgentId,
    handsRunId: HandsRunId,
  ): Promise<StoredRecord<HandsRun> | null> {
    return this.store.get(handsRunId, agentId, handsRunSchema);
  }

  async listActiveHandsRuns(agentId: AgentId): Promise<StoredRecord<HandsRun>[]> {
    return this.store.query({
      containerName: operationalContainerName,
      partitionKey: agentId,
      schema: handsRunSchema,
      where: [eq('recordType', 'hands_run'), inList('state', [...ACTIVE_HANDS_RUN_STATES])],
      orderBy: [{ field: 'createdAt', direction: 'asc' }],
    });
  }

  async replaceHandsRun(handsRun: HandsRun, expectedEtag: string): Promise<StoredRecord<HandsRun>> {
    return this.store.replace(handsRunSchema.parse(handsRun), expectedEtag);
  }

  async claimTaskForHandsRun(input: {
    handsRun: HandsRun;
    runJournal: RunJournal;
    runJournalEntry: RunJournalEntry;
    task: Task;
    taskEtag: string;
    workingContext: WorkingContext;
    workingContextEtag: string;
  }): Promise<HandsRunExecutionGraphResult> {
    const handsRun = handsRunSchema.parse(input.handsRun);
    const runJournal = runJournalSchema.parse(input.runJournal);
    const runJournalEntry = runJournalEntrySchema.parse(input.runJournalEntry);
    const task = taskSchema.parse(input.task);
    const workingContext = workingContextSchema.parse(input.workingContext);
    assertSameAgent(handsRun.agentId, [handsRun, runJournal, runJournalEntry, task, workingContext]);

    const [storedWorkingContext, storedTask, storedHandsRun, storedRunJournal, storedRunJournalEntry] =
      await this.store.batch(handsRun.agentId, [
        {
          kind: 'replace',
          record: workingContext,
          expectedEtag: input.workingContextEtag,
        },
        {
          kind: 'replace',
          record: task,
          expectedEtag: input.taskEtag,
        },
        {
          kind: 'create',
          record: handsRun,
        },
        {
          kind: 'create',
          record: runJournal,
        },
        {
          kind: 'create',
          record: runJournalEntry,
        },
      ]);

    return {
      handsRun: storedHandsRun as StoredRecord<HandsRun>,
      runJournal: storedRunJournal as StoredRecord<RunJournal>,
      runJournalEntry: storedRunJournalEntry as StoredRecord<RunJournalEntry>,
      task: storedTask as StoredRecord<Task>,
      workingContext: storedWorkingContext as StoredRecord<WorkingContext>,
    };
  }

  async claimHandsRun(input: {
    handsRun: HandsRun;
    task: Task;
    taskEtag: string;
  }): Promise<HandsRunClaimResult> {
    const handsRun = handsRunSchema.parse(input.handsRun);
    const task = taskSchema.parse(input.task);
    assertSameAgent(handsRun.agentId, [handsRun, task]);

    const [storedTask, storedHandsRun] = await this.store.batch(handsRun.agentId, [
      {
        kind: 'replace',
        record: task,
        expectedEtag: input.taskEtag,
      },
      {
        kind: 'create',
        record: handsRun,
      },
    ]);

    return {
      task: storedTask as StoredRecord<Task>,
      handsRun: storedHandsRun as StoredRecord<HandsRun>,
    };
  }

  async updateHandsRunExecution(input: {
    handsRun: HandsRun;
    handsRunEtag: string;
    runJournal: RunJournal;
    runJournalEtag: string;
    runJournalEntry?: RunJournalEntry;
    task: Task;
    taskEtag: string;
    workingContext: WorkingContext;
    workingContextEtag: string;
  }): Promise<HandsRunExecutionGraphResult> {
    const handsRun = handsRunSchema.parse(input.handsRun);
    const runJournal = runJournalSchema.parse(input.runJournal);
    const runJournalEntry = input.runJournalEntry
      ? runJournalEntrySchema.parse(input.runJournalEntry)
      : undefined;
    const task = taskSchema.parse(input.task);
    const workingContext = workingContextSchema.parse(input.workingContext);
    assertSameAgent(handsRun.agentId, [
      handsRun,
      runJournal,
      task,
      workingContext,
      ...(runJournalEntry ? [runJournalEntry] : []),
    ]);

    const operations = [
      {
        kind: 'replace' as const,
        record: workingContext,
        expectedEtag: input.workingContextEtag,
      },
      {
        kind: 'replace' as const,
        record: task,
        expectedEtag: input.taskEtag,
      },
      {
        kind: 'replace' as const,
        record: handsRun,
        expectedEtag: input.handsRunEtag,
      },
      {
        kind: 'replace' as const,
        record: runJournal,
        expectedEtag: input.runJournalEtag,
      },
      ...(runJournalEntry
        ? [
            {
              kind: 'create' as const,
              record: runJournalEntry,
            },
          ]
        : []),
    ];
    const results = await this.store.batch(handsRun.agentId, operations);

    return {
      handsRun: results[2] as StoredRecord<HandsRun>,
      runJournal: results[3] as StoredRecord<RunJournal>,
      ...(runJournalEntry
        ? {
            runJournalEntry: results[4] as StoredRecord<RunJournalEntry>,
          }
        : {}),
      task: results[1] as StoredRecord<Task>,
      workingContext: results[0] as StoredRecord<WorkingContext>,
    };
  }

  async releaseHandsRun(input: {
    handsRun: HandsRun;
    handsRunEtag: string;
    task: Task;
    taskEtag: string;
  }): Promise<HandsRunClaimResult> {
    const handsRun = handsRunSchema.parse(input.handsRun);
    const task = taskSchema.parse(input.task);
    assertSameAgent(handsRun.agentId, [handsRun, task]);

    const [storedTask, storedHandsRun] = await this.store.batch(handsRun.agentId, [
      {
        kind: 'replace',
        record: task,
        expectedEtag: input.taskEtag,
      },
      {
        kind: 'replace',
        record: handsRun,
        expectedEtag: input.handsRunEtag,
      },
    ]);

    return {
      task: storedTask as StoredRecord<Task>,
      handsRun: storedHandsRun as StoredRecord<HandsRun>,
    };
  }

  async createSandboxSession(session: SandboxSession): Promise<StoredRecord<SandboxSession>> {
    return this.store.create(sandboxSessionSchema.parse(session));
  }

  async findSandboxSession(
    sandboxSessionId: SandboxSessionId,
  ): Promise<StoredRecord<SandboxSession> | null> {
    const results = await this.store.query({
      containerName: operationalContainerName,
      schema: sandboxSessionSchema,
      where: [eq('recordType', 'sandbox_session'), eq('id', sandboxSessionId)],
      limit: 1,
    });

    return results[0] ?? null;
  }

  async getSandboxSession(
    agentId: AgentId,
    sandboxSessionId: SandboxSessionId,
  ): Promise<StoredRecord<SandboxSession> | null> {
    return this.store.get(sandboxSessionId, agentId, sandboxSessionSchema);
  }

  async listActiveSandboxSessions(agentId: AgentId): Promise<StoredRecord<SandboxSession>[]> {
    return this.store.query({
      containerName: operationalContainerName,
      partitionKey: agentId,
      schema: sandboxSessionSchema,
      where: [
        eq('recordType', 'sandbox_session'),
        inList('state', ['created', 'running']),
      ],
      orderBy: [{ field: 'createdAt', direction: 'asc' }],
    });
  }

  async replaceSandboxSession(
    session: SandboxSession,
    expectedEtag: string,
  ): Promise<StoredRecord<SandboxSession>> {
    return this.store.replace(sandboxSessionSchema.parse(session), expectedEtag);
  }
}

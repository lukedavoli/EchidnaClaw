import {
  handsRunSchema,
  headTurnSchema,
  sandboxSessionSchema,
  taskSchema,
  type AgentId,
  type HandsRun,
  type HandsRunId,
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
  getHandsRun(agentId: AgentId, handsRunId: HandsRunId): Promise<StoredRecord<HandsRun> | null>;
  listActiveHandsRuns(agentId: AgentId): Promise<StoredRecord<HandsRun>[]>;
  replaceHandsRun(handsRun: HandsRun, expectedEtag: string): Promise<StoredRecord<HandsRun>>;
  claimHandsRun(input: {
    handsRun: HandsRun;
    task: Task;
    taskEtag: string;
  }): Promise<HandsRunClaimResult>;
  releaseHandsRun(input: {
    handsRun: HandsRun;
    handsRunEtag: string;
    task: Task;
    taskEtag: string;
  }): Promise<HandsRunClaimResult>;
  createSandboxSession(session: SandboxSession): Promise<StoredRecord<SandboxSession>>;
  getSandboxSession(
    agentId: AgentId,
    sandboxSessionId: SandboxSessionId,
  ): Promise<StoredRecord<SandboxSession> | null>;
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

  async getSandboxSession(
    agentId: AgentId,
    sandboxSessionId: SandboxSessionId,
  ): Promise<StoredRecord<SandboxSession> | null> {
    return this.store.get(sandboxSessionId, agentId, sandboxSessionSchema);
  }

  async replaceSandboxSession(
    session: SandboxSession,
    expectedEtag: string,
  ): Promise<StoredRecord<SandboxSession>> {
    return this.store.replace(sandboxSessionSchema.parse(session), expectedEtag);
  }
}

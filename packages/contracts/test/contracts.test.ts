import { describe, expect, it } from 'vitest';

import {
  agentSchema,
  credentialRefSchema,
  handsRunSchema,
  headTurnSchema,
  inboundMessageSchema,
  repositoryConfigSchema,
  sandboxSessionSchema,
  taskSchema,
} from '../src/index.js';

const timestamp = '2026-04-12T00:00:00.000Z';

const correlation = {
  traceId: 'trc_step-2',
  idempotencyKey: 'idem_step-2',
  analyticsKey: 'anl_step-2',
  taskId: 'tsk_step-2',
  headTurnId: 'hdr_step-2',
  handsRunId: 'hnd_step-2',
  sandboxSessionId: 'sbx_step-2',
  inboundMessageId: 'inm_step-2',
  channelUpdateKey: 'upd_step-2',
};

describe('contracts schemas', () => {
  it('parses a valid agent record', () => {
    expect(
      agentSchema.parse({
        id: 'agt_step-2',
        recordType: 'agent',
        schemaVersion: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        correlation,
        name: 'Ops Agent',
        timeZone: 'Australia/Sydney',
        headModel: 'gpt-5.4-mini',
        provisioningState: 'pending_provisioning',
        lifecycleState: 'active',
        softDeletedAt: null,
        restoredAt: null,
        factoryProfileVersion: 'factory-v1',
        responsibilitiesSummary: 'Handles operational follow-ups.',
      }),
    ).toMatchObject({
      id: 'agt_step-2',
      headModel: 'gpt-5.4-mini',
      lifecycleState: 'active',
    });
  });

  it('rejects credential records that include raw secret material', () => {
    expect(() =>
      credentialRefSchema.parse({
        id: 'crd_step-2',
        recordType: 'credential_ref',
        schemaVersion: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        correlation,
        agentId: 'agt_step-2',
        provider: 'google',
        alias: 'primary-gmail',
        scope: 'agent',
        accessPolicyRef: 'vault/echidna-claw/credentials/google',
        encryptionKeyRef: 'vault/echidna-claw/keys/credentials',
        lastRotatedAt: null,
        expiresAt: null,
        rawSecret: 'should-not-exist',
      }),
    ).toThrow();
  });

  it('connects correlation metadata across execution records', () => {
    const inboundMessage = inboundMessageSchema.parse({
      id: 'inm_step-2',
      recordType: 'inbound_message',
      schemaVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      correlation,
      agentId: 'agt_step-2',
      channelId: 'chn_step-2',
      sequence: 1,
      receivedAt: timestamp,
      trusted: true,
      body: {
        text: 'Please check on the deployment at 9am tomorrow.',
      },
    });

    const headTurn = headTurnSchema.parse({
      id: 'hdr_step-2',
      recordType: 'head_turn',
      schemaVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      correlation,
      agentId: 'agt_step-2',
      state: 'running',
      inboundMessageIds: [inboundMessage.id],
      readThroughMessageSequence: 1,
      startedAt: timestamp,
      completedAt: null,
      supersededBySequence: null,
      responseMessageId: null,
    });

    const task = taskSchema.parse({
      id: 'tsk_step-2',
      recordType: 'task',
      schemaVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      correlation,
      agentId: 'agt_step-2',
      type: 'follow_up',
      state: 'queued',
      queue: {
        priority: 'normal',
      },
      requestedOutcome: 'Confirm deployment health',
      requestedBy: {
        kind: 'user',
        sourceMessageId: inboundMessage.id,
      },
      dueAt: timestamp,
      stateEnteredAt: timestamp,
      currentHandsRunId: null,
      activeApprovalId: null,
      artifactIds: [],
      externalReferences: [],
      notes: 'Follow up before stand-up.',
    });

    const handsRun = handsRunSchema.parse({
      id: 'hnd_step-2',
      recordType: 'hands_run',
      schemaVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      correlation,
      agentId: task.agentId,
      taskId: task.id,
      taskEnvelopeId: 'env_step-2',
      state: 'running',
      startedAt: timestamp,
      completedAt: null,
      releasedAt: null,
    });

    const sandboxSession = sandboxSessionSchema.parse({
      id: 'sbx_step-2',
      recordType: 'sandbox_session',
      schemaVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      correlation,
      agentId: task.agentId,
      handsRunId: handsRun.id,
      taskId: task.id,
      state: 'created',
      policyName: 'standard',
      allowedOutboundHosts: ['api.telegram.org'],
      startedAt: null,
      completedAt: null,
    });

    expect(headTurn.correlation.inboundMessageId).toBe(inboundMessage.id);
    expect(handsRun.correlation.taskId).toBe(task.id);
    expect(sandboxSession.correlation.handsRunId).toBe(handsRun.id);
  });

  it('enforces repository-config invariants', () => {
    expect(() =>
      repositoryConfigSchema.parse({
        version: '1',
        models: {
          defaultModel: 'gpt-5.4-mini',
          pricing: [],
        },
        sandbox: {
          defaultPolicy: 'missing',
          policies: [],
          packageAllowlists: [],
        },
        capabilities: {
          registry: [],
        },
      }),
    ).toThrow();
  });
});

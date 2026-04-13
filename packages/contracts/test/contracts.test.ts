import { describe, expect, it } from 'vitest';

import {
  adminAgentSummarySchema,
  agentSchema,
  channelActionResponseSchema,
  credentialRefSchema,
  credentialSecretSchema,
  errorResponseSchema,
  handsRunSchema,
  headStartTurnRequestSchema,
  headTurnExecutionResultSchema,
  headTurnSchema,
  idempotencyRecordSchema,
  inboundMessageSchema,
  outboundMessageSchema,
  readinessResponseSchema,
  repositoryConfigSchema,
  sandboxSessionSchema,
  sendChannelMessageRequestSchema,
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
        primaryChannelId: 'chn_step-2',
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

  it('parses admin agent summaries with primary-channel provisioning metadata', () => {
    expect(
      adminAgentSummarySchema.parse({
        agent: agentSchema.parse({
          id: 'agt_summary',
          recordType: 'agent',
          schemaVersion: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
          correlation,
          name: 'Summary Agent',
          timeZone: 'Australia/Sydney',
          headModel: 'gpt-5.4-mini',
          primaryChannelId: 'chn_summary',
          provisioningState: 'provisioning_failed',
          lifecycleState: 'active',
          softDeletedAt: null,
          restoredAt: null,
          factoryProfileVersion: 'factory-v1',
          responsibilitiesSummary: 'Handles summary DTO tests.',
        }),
        primaryChannel: {
          id: 'chn_summary',
          provider: 'telegram',
          state: 'provisioning_failed',
          provisioningRequestedAt: timestamp,
          provisioningStartedAt: timestamp,
          boundAt: null,
          lastProvisioningFailedAt: timestamp,
          lastProvisioningErrorCode: 'telegram_bind_failed',
          lastProvisioningErrorMessage: 'The managed bot could not be bound.',
          recoveryAttemptCount: 1,
          lastRecoveryRequestedAt: null,
          conversationUrl: undefined,
        },
      }),
    ).toMatchObject({
      primaryChannel: {
        state: 'provisioning_failed',
      },
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
        status: 'active',
        accessPolicyRef: 'vault/echidna-claw/credentials/google',
        encryptionKeyRef: 'vault/echidna-claw/keys/credentials',
        lastRotatedAt: null,
        revokedAt: null,
        expiresAt: null,
        rawSecret: 'should-not-exist',
      }),
    ).toThrow();
  });

  it('parses encrypted credential-secret payload records without exposing plaintext', () => {
    expect(
      credentialSecretSchema.parse({
        id: 'cse_step-2',
        recordType: 'credential_secret',
        schemaVersion: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        correlation,
        agentId: 'agt_step-2',
        credentialId: 'crd_step-2',
        envelopeVersion: 1,
        encryptionAlgorithm: 'AES-256-GCM',
        wrappingAlgorithm: 'RSA-OAEP-256',
        keyEncryptionKeyId: 'https://vault.example/keys/credential-encryption/version',
        wrappedDataKey: 'wrapped-key',
        initializationVector: 'iv',
        authenticationTag: 'tag',
        ciphertext: 'ciphertext',
      }),
    ).toMatchObject({
      credentialId: 'crd_step-2',
      envelopeVersion: 1,
    });
  });

  it('parses persisted idempotency records for reserve and replay flows', () => {
    expect(
      idempotencyRecordSchema.parse({
        id: 'idr_step-2',
        recordType: 'idempotency_record',
        schemaVersion: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        correlation,
        agentId: 'agt_step-2',
        scope: 'telegram:webhook',
        key: 'tg-update-42',
        status: 'completed',
        resultReference: 'inm_step-2',
        expiresAt: '2026-04-19T00:00:00.000Z',
      }),
    ).toMatchObject({
      scope: 'telegram:webhook',
      status: 'completed',
      resultReference: 'inm_step-2',
    });
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
      workingContextId: 'ctx_step-2',
      state: 'running',
      triggerKind: 'trusted_messages',
      inboundMessageIds: [inboundMessage.id],
      readThroughMessageSequence: 1,
      taskId: null,
      scheduleId: null,
      dueAt: null,
      startedAt: timestamp,
      completedAt: null,
      supersededBySequence: null,
      providerConversationId: 'conversation-step-2',
      providerRunId: 'run-step-2',
      promptProfileVersion: 'head-base-v1',
      completionKind: null,
      failureCode: undefined,
      failureMessage: undefined,
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

  it('parses Telegram outbound commands and callback action responses', () => {
    expect(
      sendChannelMessageRequestSchema.parse({
        actions: [
          {
            approvalId: 'apr_step-9',
            decision: 'approve',
            kind: 'approval_decision',
            label: 'Approve',
          },
        ],
        agentId: 'agt_step-2',
        channelId: 'chn_step-2',
        correlation,
        inReplyToInboundMessageId: 'inm_step-2',
        text: 'Approve the deployment restart?',
      }),
    ).toMatchObject({
      actions: [
        {
          kind: 'approval_decision',
        },
      ],
    });

    expect(
      outboundMessageSchema.parse({
        actions: [
          {
            approvalId: 'apr_step-9',
            decision: 'reject',
            kind: 'approval_decision',
            label: 'Reject',
          },
        ],
        agentId: 'agt_step-2',
        body: {
          text: 'Awaiting approval.',
        },
        channelId: 'chn_step-2',
        correlation,
        createdAt: timestamp,
        deliveredAt: null,
        deliveryState: 'sent',
        externalMessageId: 'telegram-99',
        failedAt: null,
        id: 'out_step-9',
        recordType: 'outbound_message',
        requestedAt: timestamp,
        schemaVersion: 1,
        sentAt: timestamp,
        updatedAt: timestamp,
      }),
    ).toMatchObject({
      deliveryState: 'sent',
      externalMessageId: 'telegram-99',
    });

    expect(
      channelActionResponseSchema.parse({
        agentId: 'agt_step-2',
        approvalId: 'apr_step-9',
        channelId: 'chn_step-2',
        correlation,
        decision: 'approve',
        inboundMessageId: 'inm_step-2',
        kind: 'approval_decision',
      }),
    ).toMatchObject({
      decision: 'approve',
      kind: 'approval_decision',
    });
  });

  it('parses trigger-aware head start requests and execution results', () => {
    const request = headStartTurnRequestSchema.parse({
      agentId: 'agt_step-2',
      workingContextId: 'ctx_step-2',
      trigger: {
        kind: 'trusted_messages',
        channelId: 'chn_step-2',
        inboundMessageIds: ['inm_step-2'],
        readThroughMessageSequence: 1,
      },
      correlation,
    });

    expect(request.trigger.kind).toBe('trusted_messages');

    expect(
      headTurnExecutionResultSchema.parse({
        headTurn: {
          id: 'hdr_reply',
          recordType: 'head_turn',
          schemaVersion: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
          correlation: {
            ...correlation,
            headTurnId: 'hdr_reply',
          },
          agentId: 'agt_step-2',
          workingContextId: 'ctx_step-2',
          state: 'completed',
          triggerKind: 'trusted_messages',
          inboundMessageIds: ['inm_step-2'],
          readThroughMessageSequence: 1,
          taskId: null,
          scheduleId: null,
          dueAt: null,
          startedAt: timestamp,
          completedAt: timestamp,
          supersededBySequence: null,
          providerConversationId: 'conversation-step-2',
          providerRunId: 'run-step-2',
          promptProfileVersion: 'head-base-v1',
          completionKind: 'reply',
          responseMessageId: null,
        },
        status: 'replied',
        replyDraft: {
          agentId: 'agt_step-2',
          channelId: 'chn_step-2',
          inReplyToInboundMessageId: 'inm_step-2',
          body: {
            text: 'The deployment looks healthy.',
          },
        },
        effectSummary: {
          taskRequested: false,
          scheduleChangeRequested: false,
          approvalRequested: false,
          sandboxRequested: false,
          memoryOperationRequested: false,
        },
      }),
    ).toMatchObject({
      status: 'replied',
      replyDraft: {
        body: {
          text: 'The deployment looks healthy.',
        },
      },
    });
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

  it('parses the shared readiness and error envelopes', () => {
    expect(
      readinessResponseSchema.parse({
        dependencies: {
          repositories: {
            description: 'Repositories are ready.',
            mode: 'stubbed',
            ready: true,
          },
        },
        runtimeMode: 'local-minimal',
        service: 'api',
        status: 'ready',
      }),
    ).toMatchObject({
      status: 'ready',
    });

    expect(
      errorResponseSchema.parse({
        error: {
          code: 'dependency_unavailable',
          message: 'The dependency is offline.',
          retryable: true,
          traceId: 'trc_step-7',
        },
      }),
    ).toMatchObject({
      error: {
        traceId: 'trc_step-7',
      },
    });
  });
});

import {
  credentialRefSchema,
  credentialSecretSchema,
  type AgentId,
  type CredentialId,
  type CredentialRef,
  type CredentialSecret,
} from '@echidna-claw/contracts';

import {
  decodeCiphertext,
  type CredentialEnvelopeCipher,
} from '../crypto/credential-envelope.js';
import { type StoredRecord } from '../documents/envelope.js';
import { eq, operationalContainerName } from './common.js';
import { type PersistedRecordStore } from './store.js';

function deriveCredentialSecretId(credentialId: CredentialId): CredentialSecret['id'] {
  return credentialId.replace(/^crd_/, 'cse_') as CredentialSecret['id'];
}

function buildCredentialSecret(
  credentialRef: CredentialRef,
  payload: Awaited<ReturnType<CredentialEnvelopeCipher['encrypt']>>,
  createdAt: string,
): CredentialSecret {
  return credentialSecretSchema.parse({
    id: deriveCredentialSecretId(credentialRef.id),
    recordType: 'credential_secret',
    schemaVersion: credentialRef.schemaVersion,
    createdAt,
    updatedAt: credentialRef.updatedAt,
    correlation: credentialRef.correlation,
    agentId: credentialRef.agentId,
    credentialId: credentialRef.id,
    ...payload,
  });
}

export interface CredentialWriteResult {
  credentialRef: StoredRecord<CredentialRef>;
  credentialSecret: StoredRecord<CredentialSecret>;
}

export interface CredentialRepository {
  createCredential(input: {
    credentialRef: CredentialRef;
    plaintext: string | Uint8Array;
  }): Promise<CredentialWriteResult>;
  get(agentId: AgentId, credentialId: CredentialId): Promise<StoredRecord<CredentialRef> | null>;
  listByAgent(agentId: AgentId): Promise<StoredRecord<CredentialRef>[]>;
  findByAlias(
    agentId: AgentId,
    provider: string,
    alias: string,
  ): Promise<StoredRecord<CredentialRef> | null>;
  rotateCredential(input: {
    credentialRef: CredentialRef;
    expectedCredentialRefEtag: string;
    plaintext: string | Uint8Array;
  }): Promise<CredentialWriteResult>;
  revokeCredential(input: {
    credentialRef: CredentialRef;
    expectedCredentialRefEtag: string;
  }): Promise<StoredRecord<CredentialRef>>;
  decryptCredential(agentId: AgentId, credentialId: CredentialId): Promise<string | null>;
}

export class DefaultCredentialRepository implements CredentialRepository {
  constructor(
    private readonly store: PersistedRecordStore,
    private readonly credentialEnvelopeCipher: CredentialEnvelopeCipher,
  ) {}

  private async getSecret(
    agentId: AgentId,
    credentialId: CredentialId,
  ): Promise<StoredRecord<CredentialSecret> | null> {
    return this.store.get(deriveCredentialSecretId(credentialId), agentId, credentialSecretSchema);
  }

  async createCredential(input: {
    credentialRef: CredentialRef;
    plaintext: string | Uint8Array;
  }): Promise<CredentialWriteResult> {
    const credentialRef = credentialRefSchema.parse(input.credentialRef);
    const payload = await this.credentialEnvelopeCipher.encrypt(input.plaintext);
    const credentialSecret = buildCredentialSecret(credentialRef, payload, credentialRef.createdAt);

    const [storedCredentialRef, storedCredentialSecret] = await this.store.batch(credentialRef.agentId, [
      {
        kind: 'create',
        record: credentialRef,
      },
      {
        kind: 'create',
        record: credentialSecret,
      },
    ]);

    return {
      credentialRef: storedCredentialRef as StoredRecord<CredentialRef>,
      credentialSecret: storedCredentialSecret as StoredRecord<CredentialSecret>,
    };
  }

  async get(agentId: AgentId, credentialId: CredentialId): Promise<StoredRecord<CredentialRef> | null> {
    return this.store.get(credentialId, agentId, credentialRefSchema);
  }

  async listByAgent(agentId: AgentId): Promise<StoredRecord<CredentialRef>[]> {
    return this.store.query({
      containerName: operationalContainerName,
      partitionKey: agentId,
      schema: credentialRefSchema,
      where: [eq('recordType', 'credential_ref')],
      orderBy: [{ field: 'updatedAt', direction: 'desc' }],
    });
  }

  async findByAlias(
    agentId: AgentId,
    provider: string,
    alias: string,
  ): Promise<StoredRecord<CredentialRef> | null> {
    const results = await this.store.query({
      containerName: operationalContainerName,
      partitionKey: agentId,
      schema: credentialRefSchema,
      where: [
        eq('recordType', 'credential_ref'),
        eq('provider', provider),
        eq('alias', alias),
      ],
      orderBy: [{ field: 'updatedAt', direction: 'desc' }],
      limit: 1,
    });

    return results[0] ?? null;
  }

  async rotateCredential(input: {
    credentialRef: CredentialRef;
    expectedCredentialRefEtag: string;
    plaintext: string | Uint8Array;
  }): Promise<CredentialWriteResult> {
    const credentialRef = credentialRefSchema.parse(input.credentialRef);
    const payload = await this.credentialEnvelopeCipher.encrypt(input.plaintext);
    const existingSecret = await this.getSecret(credentialRef.agentId, credentialRef.id);
    const credentialSecret = buildCredentialSecret(
      credentialRef,
      payload,
      existingSecret?.value.createdAt ?? credentialRef.createdAt,
    );

    const operations = [
      {
        kind: 'replace' as const,
        record: credentialRef,
        expectedEtag: input.expectedCredentialRefEtag,
      },
      existingSecret
        ? {
            kind: 'replace' as const,
            record: credentialSecret,
            expectedEtag: existingSecret.etag,
          }
        : {
            kind: 'create' as const,
            record: credentialSecret,
          },
    ];

    const [storedCredentialRef, storedCredentialSecret] = await this.store.batch(
      credentialRef.agentId,
      operations,
    );

    return {
      credentialRef: storedCredentialRef as StoredRecord<CredentialRef>,
      credentialSecret: storedCredentialSecret as StoredRecord<CredentialSecret>,
    };
  }

  async revokeCredential(input: {
    credentialRef: CredentialRef;
    expectedCredentialRefEtag: string;
  }): Promise<StoredRecord<CredentialRef>> {
    return this.store.replace(
      credentialRefSchema.parse(input.credentialRef),
      input.expectedCredentialRefEtag,
    );
  }

  async decryptCredential(agentId: AgentId, credentialId: CredentialId): Promise<string | null> {
    const credentialRef = await this.get(agentId, credentialId);
    if (!credentialRef || credentialRef.value.status !== 'active') {
      return null;
    }

    const credentialSecret = await this.getSecret(agentId, credentialId);
    if (!credentialSecret) {
      return null;
    }

    const plaintext = await this.credentialEnvelopeCipher.decrypt(credentialSecret.value);
    return decodeCiphertext(plaintext);
  }
}

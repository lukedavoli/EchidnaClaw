import {
  artifactSchema,
  type AgentId,
  type Artifact,
  type ArtifactId,
} from '@echidna-claw/contracts';

import { type ArtifactContentStore } from '../blob/artifact-store.js';
import { type StoredRecord } from '../documents/envelope.js';
import { type Clock } from '../testing/fake-clock.js';
import { type PersistedRecordStore } from './store.js';

const DEFAULT_RETENTION_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function toIsoString(date: Date): string {
  return new Date(date.getTime()).toISOString();
}

export interface ArtifactRepository {
  create(artifact: Artifact): Promise<StoredRecord<Artifact>>;
  get(agentId: AgentId, artifactId: ArtifactId): Promise<StoredRecord<Artifact> | null>;
  replace(artifact: Artifact, expectedEtag: string): Promise<StoredRecord<Artifact>>;
  writeArtifact(input: {
    artifact: Artifact;
    body: string | Uint8Array;
  }): Promise<StoredRecord<Artifact>>;
}

export class DefaultArtifactRepository implements ArtifactRepository {
  constructor(
    private readonly store: PersistedRecordStore,
    private readonly artifactContentStore: ArtifactContentStore,
    private readonly clock: Clock,
  ) {}

  async create(artifact: Artifact): Promise<StoredRecord<Artifact>> {
    return this.store.create(artifactSchema.parse(artifact));
  }

  async get(agentId: AgentId, artifactId: ArtifactId): Promise<StoredRecord<Artifact> | null> {
    return this.store.get(artifactId, agentId, artifactSchema);
  }

  async replace(artifact: Artifact, expectedEtag: string): Promise<StoredRecord<Artifact>> {
    return this.store.replace(artifactSchema.parse(artifact), expectedEtag);
  }

  async writeArtifact(input: {
    artifact: Artifact;
    body: string | Uint8Array;
  }): Promise<StoredRecord<Artifact>> {
    const artifact = artifactSchema.parse(input.artifact);
    const retentionUntil =
      artifact.retentionUntil ??
      toIsoString(new Date(this.clock.now().getTime() + DEFAULT_RETENTION_WINDOW_MS));

    const upload = await this.artifactContentStore.upload({
      agentId: artifact.agentId,
      artifactId: artifact.id,
      body: input.body,
      contentType: artifact.contentType,
      metadata: {
        retentionUntil,
      },
    });

    const persistedArtifact: Artifact = {
      ...artifact,
      blobPath: upload.blobPath,
      sizeBytes: upload.sizeBytes,
      retentionUntil,
    };

    try {
      return await this.store.create(persistedArtifact);
    } catch (error) {
      try {
        await this.artifactContentStore.deleteIfExists(upload.blobPath);
      } catch {
        // Blob cleanup is best-effort and should not mask the metadata failure.
      }

      throw error;
    }
  }
}

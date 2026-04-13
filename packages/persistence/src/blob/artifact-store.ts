import { Buffer } from 'node:buffer';

import { BlobServiceClient } from '@azure/storage-blob';
import { type AgentId, type ArtifactId } from '@echidna-claw/contracts';

export interface ArtifactUploadResult {
  blobPath: string;
  sizeBytes: number;
}

export interface ArtifactContentStore {
  upload(input: {
    agentId: AgentId;
    artifactId: ArtifactId;
    body: string | Uint8Array;
    contentType: string;
    metadata?: Readonly<Record<string, string>>;
  }): Promise<ArtifactUploadResult>;
  deleteIfExists(blobPath: string): Promise<void>;
}

export function buildArtifactBlobPath(agentId: AgentId, artifactId: ArtifactId): string {
  return `agents/${agentId}/artifacts/${artifactId}`;
}

function normalizeBinary(body: string | Uint8Array): Buffer {
  return typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
}

export class AzureArtifactContentStore implements ArtifactContentStore {
  constructor(
    private readonly blobServiceClient: BlobServiceClient,
    private readonly containerName: string,
  ) {}

  async upload(input: {
    agentId: AgentId;
    artifactId: ArtifactId;
    body: string | Uint8Array;
    contentType: string;
    metadata?: Readonly<Record<string, string>>;
  }): Promise<ArtifactUploadResult> {
    const blobPath = buildArtifactBlobPath(input.agentId, input.artifactId);
    const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
    const blobClient = containerClient.getBlockBlobClient(blobPath);
    const payload = normalizeBinary(input.body);
    const uploadOptions = {
      blobHTTPHeaders: {
        blobContentType: input.contentType,
      },
      ...(input.metadata ? { metadata: { ...input.metadata } } : {}),
    };

    await blobClient.uploadData(payload, uploadOptions);

    return {
      blobPath,
      sizeBytes: payload.byteLength,
    };
  }

  async deleteIfExists(blobPath: string): Promise<void> {
    const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
    await containerClient.getBlockBlobClient(blobPath).deleteIfExists({
      deleteSnapshots: 'include',
    });
  }
}

export class InMemoryArtifactContentStore implements ArtifactContentStore {
  private readonly blobs = new Map<
    string,
    {
      contentType: string;
      data: Buffer;
      metadata: Record<string, string>;
    }
  >();

  async upload(input: {
    agentId: AgentId;
    artifactId: ArtifactId;
    body: string | Uint8Array;
    contentType: string;
    metadata?: Readonly<Record<string, string>>;
  }): Promise<ArtifactUploadResult> {
    const blobPath = buildArtifactBlobPath(input.agentId, input.artifactId);
    const data = normalizeBinary(input.body);

    this.blobs.set(blobPath, {
      contentType: input.contentType,
      data,
      metadata: input.metadata ? { ...input.metadata } : {},
    });

    return {
      blobPath,
      sizeBytes: data.byteLength,
    };
  }

  async deleteIfExists(blobPath: string): Promise<void> {
    this.blobs.delete(blobPath);
  }

  read(blobPath: string): Buffer | undefined {
    return this.blobs.get(blobPath)?.data;
  }
}

import { DefaultAzureCredential, type TokenCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';

export interface BlobClientOptions {
  accountUrl: string;
  credential?: TokenCredential;
}

export function createBlobServiceClient(options: BlobClientOptions): BlobServiceClient {
  return new BlobServiceClient(
    options.accountUrl,
    options.credential ?? new DefaultAzureCredential(),
  );
}

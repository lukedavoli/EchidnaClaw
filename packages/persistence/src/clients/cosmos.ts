import { DefaultAzureCredential, type TokenCredential } from '@azure/identity';
import { CosmosClient } from '@azure/cosmos';

export interface CosmosClientOptions {
  endpoint: string;
  credential?: TokenCredential;
}

export function createCosmosClient(options: CosmosClientOptions): CosmosClient {
  return new CosmosClient({
    endpoint: options.endpoint,
    aadCredentials: options.credential ?? new DefaultAzureCredential(),
  } as ConstructorParameters<typeof CosmosClient>[0]);
}

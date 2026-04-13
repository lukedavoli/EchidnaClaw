import { DefaultAzureCredential, type TokenCredential } from '@azure/identity';
import { CryptographyClient } from '@azure/keyvault-keys';

import { KeyVaultKeyEncryptionKey } from '../crypto/credential-envelope.js';

export interface KeyVaultClientOptions {
  keyId: string;
  credential?: TokenCredential;
}

export function createCryptographyClient(options: KeyVaultClientOptions): CryptographyClient {
  return new CryptographyClient(options.keyId, options.credential ?? new DefaultAzureCredential());
}

export function createKeyVaultKeyEncryptionKey(options: KeyVaultClientOptions): KeyVaultKeyEncryptionKey {
  return new KeyVaultKeyEncryptionKey(createCryptographyClient(options), options.keyId);
}

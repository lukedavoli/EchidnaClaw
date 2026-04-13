import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { CryptographyClient } from '@azure/keyvault-keys';
import { type CredentialSecret } from '@echidna-claw/contracts';

type CredentialEnvelopePayload = Pick<
  CredentialSecret,
  | 'authenticationTag'
  | 'ciphertext'
  | 'encryptionAlgorithm'
  | 'envelopeVersion'
  | 'initializationVector'
  | 'keyEncryptionKeyId'
  | 'wrappedDataKey'
  | 'wrappingAlgorithm'
>;

export interface KeyEncryptionKey {
  readonly keyId: string;
  wrapKey(key: Uint8Array): Promise<Uint8Array>;
  unwrapKey(wrappedKey: Uint8Array): Promise<Uint8Array>;
}

export interface CredentialEnvelopeCipher {
  encrypt(plaintext: string | Uint8Array): Promise<CredentialEnvelopePayload>;
  decrypt(payload: CredentialEnvelopePayload): Promise<Uint8Array>;
}

function toBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
}

export function decodeCiphertext(payload: Uint8Array): string {
  return Buffer.from(payload).toString('utf8');
}

export class KeyVaultKeyEncryptionKey implements KeyEncryptionKey {
  constructor(
    private readonly cryptographyClient: CryptographyClient,
    readonly keyId: string,
  ) {}

  async wrapKey(key: Uint8Array): Promise<Uint8Array> {
    const result = await this.cryptographyClient.wrapKey('RSA-OAEP-256', key);
    return result.result;
  }

  async unwrapKey(wrappedKey: Uint8Array): Promise<Uint8Array> {
    const result = await this.cryptographyClient.unwrapKey('RSA-OAEP-256', wrappedKey);
    return result.result;
  }
}

export class StaticKeyEncryptionKey implements KeyEncryptionKey {
  constructor(
    readonly keyId: string,
    private readonly wrappingKey: Uint8Array,
  ) {}

  async wrapKey(key: Uint8Array): Promise<Uint8Array> {
    return key.map((value, index) => {
      const mask = this.wrappingKey[index % this.wrappingKey.length];
      if (mask === undefined) {
        throw new Error('Static wrapping key must not be empty.');
      }

      return value ^ mask;
    });
  }

  async unwrapKey(wrappedKey: Uint8Array): Promise<Uint8Array> {
    return wrappedKey.map((value, index) => {
      const mask = this.wrappingKey[index % this.wrappingKey.length];
      if (mask === undefined) {
        throw new Error('Static wrapping key must not be empty.');
      }

      return value ^ mask;
    });
  }
}

export class AesGcmCredentialEnvelopeCipher implements CredentialEnvelopeCipher {
  constructor(private readonly keyEncryptionKey: KeyEncryptionKey) {}

  async encrypt(plaintext: string | Uint8Array): Promise<CredentialEnvelopePayload> {
    const dataKey = randomBytes(32);
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dataKey, initializationVector);
    const input = toBytes(plaintext);
    const ciphertext = Buffer.concat([cipher.update(input), cipher.final()]);
    const authenticationTag = cipher.getAuthTag();
    const wrappedDataKey = await this.keyEncryptionKey.wrapKey(dataKey);

    return {
      envelopeVersion: 1,
      encryptionAlgorithm: 'AES-256-GCM',
      wrappingAlgorithm: 'RSA-OAEP-256',
      keyEncryptionKeyId: this.keyEncryptionKey.keyId,
      wrappedDataKey: Buffer.from(wrappedDataKey).toString('base64'),
      initializationVector: Buffer.from(initializationVector).toString('base64'),
      authenticationTag: Buffer.from(authenticationTag).toString('base64'),
      ciphertext: Buffer.from(ciphertext).toString('base64'),
    };
  }

  async decrypt(payload: CredentialEnvelopePayload): Promise<Uint8Array> {
    if (payload.envelopeVersion !== 1) {
      throw new Error(`Unsupported credential envelope version '${payload.envelopeVersion}'.`);
    }

    if (payload.encryptionAlgorithm !== 'AES-256-GCM') {
      throw new Error(`Unsupported credential encryption algorithm '${payload.encryptionAlgorithm}'.`);
    }

    if (payload.wrappingAlgorithm !== 'RSA-OAEP-256') {
      throw new Error(`Unsupported key wrapping algorithm '${payload.wrappingAlgorithm}'.`);
    }

    const dataKey = await this.keyEncryptionKey.unwrapKey(Buffer.from(payload.wrappedDataKey, 'base64'));
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(dataKey),
      Buffer.from(payload.initializationVector, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(payload.authenticationTag, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, 'base64')),
      decipher.final(),
    ]);
  }
}

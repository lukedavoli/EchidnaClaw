import { describe, expect, it } from 'vitest';

import {
  AesGcmCredentialEnvelopeCipher,
  StaticKeyEncryptionKey,
  decodeCiphertext,
} from '../src/index.js';

describe('credential envelope encryption', () => {
  it('encrypts and decrypts credential payloads with versioned envelopes', async () => {
    const cipher = new AesGcmCredentialEnvelopeCipher(
      new StaticKeyEncryptionKey('local://test-key', new Uint8Array([7, 13, 19, 29])),
    );

    const envelope = await cipher.encrypt('super-secret-token');
    const plaintext = await cipher.decrypt(envelope);

    expect(envelope.envelopeVersion).toBe(1);
    expect(envelope.keyEncryptionKeyId).toBe('local://test-key');
    expect(decodeCiphertext(plaintext)).toBe('super-secret-token');
  });

  it('rejects unsupported envelope versions', async () => {
    const cipher = new AesGcmCredentialEnvelopeCipher(
      new StaticKeyEncryptionKey('local://test-key', new Uint8Array([7, 13, 19, 29])),
    );

    await expect(
      cipher.decrypt({
        envelopeVersion: 2 as 1,
        encryptionAlgorithm: 'AES-256-GCM',
        wrappingAlgorithm: 'RSA-OAEP-256',
        keyEncryptionKeyId: 'local://test-key',
        wrappedDataKey: 'wrapped',
        initializationVector: 'iv',
        authenticationTag: 'tag',
        ciphertext: 'ciphertext',
      }),
    ).rejects.toThrow(/unsupported credential envelope version/i);
  });
});

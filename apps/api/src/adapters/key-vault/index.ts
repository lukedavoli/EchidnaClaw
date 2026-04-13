import { NotImplementedYetError } from '../../http/errors.js';

export interface SecretAccessAdapter {
  getSecret(secretName: string): Promise<string>;
}

export interface EncryptionKeyAccessAdapter {
  getEncryptionKey(): Promise<string>;
}

export interface KeyVaultAdapters {
  encryptionKeys: EncryptionKeyAccessAdapter;
  secrets: SecretAccessAdapter;
}

export function createKeyVaultAdapters(mode: 'stubbed' | 'configured_placeholder'): {
  adapters: KeyVaultAdapters;
  health: {
    description: string;
    mode: 'stubbed' | 'configured_placeholder';
    ready: true;
  };
} {
  return {
    adapters: {
      encryptionKeys: {
        async getEncryptionKey(): Promise<string> {
          throw new NotImplementedYetError(
            'Key Vault encryption-key access is reserved for a later credential step.',
          );
        },
      },
      secrets: {
        async getSecret(_secretName: string): Promise<string> {
          void _secretName;
          throw new NotImplementedYetError(
            'Key Vault secret access is reserved for a later credential step.',
          );
        },
      },
    },
    health: {
      description:
        mode === 'stubbed'
          ? 'Key Vault wrappers are stubbed for local-minimal startup.'
          : 'Key Vault config is present; real accessors are reserved for later steps.',
      mode,
      ready: true,
    },
  };
}

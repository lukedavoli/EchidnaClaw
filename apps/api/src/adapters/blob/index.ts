import { NotImplementedYetError } from '../../http/errors.js';

export interface ArtifactStorageAdapter {
  storeArtifact(artifactName: string): Promise<string>;
}

export function createArtifactStorageAdapter(mode: 'stubbed' | 'configured_placeholder'): {
  adapter: ArtifactStorageAdapter;
  health: {
    description: string;
    mode: 'stubbed' | 'configured_placeholder';
    ready: true;
  };
} {
  return {
    adapter: {
      async storeArtifact(_artifactName: string): Promise<string> {
        throw new NotImplementedYetError(
          'Artifact storage is reserved for later persistence steps.',
        );
      },
    },
    health: {
      description:
        mode === 'stubbed'
          ? 'Blob storage is stubbed for local-minimal startup.'
          : 'Blob storage config is present; the adapter is reserved for later steps.',
      mode,
      ready: true,
    },
  };
}

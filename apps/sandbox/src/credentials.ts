import type { SandboxCredentialBinding } from '@echidna-claw/contracts';

export interface SandboxCredentialResolver {
  resolveBindings(input: {
    credentialBindings: SandboxCredentialBinding[];
    sessionId: string;
  }): Promise<Record<string, string>>;
}

export class NoopSandboxCredentialResolver implements SandboxCredentialResolver {
  async resolveBindings(): Promise<Record<string, string>> {
    return {};
  }
}

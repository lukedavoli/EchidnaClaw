export interface SandboxCredentialResolver {
  resolveBindings(input: {
    credentialAliases: string[];
    sessionId: string;
  }): Promise<Record<string, string>>;
}

export class NoopSandboxCredentialResolver implements SandboxCredentialResolver {
  async resolveBindings(): Promise<Record<string, string>> {
    return {};
  }
}

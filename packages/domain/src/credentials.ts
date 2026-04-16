import type {
  CredentialRef,
  RepositoryConfig,
  SandboxCredentialBinding,
} from '@echidna-claw/contracts';

export type CredentialServiceConfig = RepositoryConfig['credentials']['services'][number];

export function resolveCredentialService(
  repositoryConfig: RepositoryConfig,
  alias: string,
): CredentialServiceConfig {
  const service = repositoryConfig.credentials.services.find((entry) => entry.alias === alias);
  if (!service) {
    throw new Error(`Credential service alias '${alias}' is not configured.`);
  }

  return service;
}

export function resolveCredentialServiceByProviderAlias(
  repositoryConfig: RepositoryConfig,
  provider: string,
  alias: string,
): CredentialServiceConfig {
  const service = repositoryConfig.credentials.services.find(
    (entry) => entry.provider === provider && entry.alias === alias,
  );
  if (!service) {
    throw new Error(`Credential service '${provider}:${alias}' is not configured.`);
  }

  return service;
}

export function createSandboxCredentialBindings(input: {
  credential: CredentialRef;
  service: CredentialServiceConfig;
}): SandboxCredentialBinding[] {
  return input.service.sandboxBindings.map((binding) => ({
    credentialId: input.credential.id,
    provider: input.credential.provider,
    alias: input.credential.alias,
    exposure: binding.exposure,
    targetName: binding.targetName,
  }));
}

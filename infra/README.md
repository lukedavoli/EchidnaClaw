# Infrastructure

This directory holds the repository's Azure infrastructure code.

## Current Scope

The current implementation covers Phase 4 of `docs/implementation-plan-step-3-infrastructure.md`: the Azure AI Foundry contract module and its environment entrypoints.

## Deployment Entry Point

Use `infra/environments/main.bicep` with one of the environment parameter files:

- `infra/environments/dev.bicepparam`
- `infra/environments/test.bicepparam`
- `infra/environments/prod.bicepparam`

Example:

```powershell
az deployment group create `
  --resource-group <resource-group-name> `
  --template-file infra/environments/main.bicep `
  --parameters infra/environments/dev.bicepparam
```

## Foundry Modes

`infra/modules/ai/foundry.bicep` supports two modes:

- `attach`: points EchidnaClaw at an existing Azure AI Foundry account and project.
- `create`: provisions an Azure AI Services-backed Foundry account and project, and can optionally create the default model deployment contract.

The checked-in parameter files default to `attach` mode so the infrastructure skeleton does not block on quota, region availability, or organization-managed Foundry ownership.

## Output Contract

The environment template emits the normalized Foundry values later application steps need:

- `foundryEndpoint`
- `foundryModelInferenceEndpoint`
- `foundryMemoryStoreEndpointOrId`
- `defaultModelDeploymentName`

It also emits the account and project names plus resource IDs so later Bicep phases can consume the same contract without knowing whether `attach` or `create` was used.

## Memory Store Note

Azure AI Foundry Memory Store is currently treated here as a data-plane contract rather than an ARM-managed resource. The module therefore outputs a normalized memory-store endpoint-or-id value, but it does not attempt to provision the memory store itself in Bicep.

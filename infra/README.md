# Infrastructure

This directory contains the initial Azure Bicep skeleton for EchidnaClaw Step 3.

## Layout

- `modules/foundation`: shared runtime prerequisites such as ACR, Log Analytics, Application Insights, the Container Apps environment, and user-assigned identities.
- `modules/data`: Cosmos DB, Blob Storage, and Key Vault.
- `modules/ai`: the normalized Foundry contract with `attach` mode and a guarded `create` path for the AI account, project, and model deployment.
- `modules/hosting`: reusable Container App and Container Apps Job modules plus explicit wrappers for `api`, `sandbox`, `hands`, and `scheduler`.
- `modules/channel`: public-edge outputs for webhook and hostname wiring.
- `modules/observability`: baseline diagnostic settings routed into Log Analytics.
- `environments/main.bicep`: the full resource-group composition.
- `environments/*.bicepparam`: environment-specific parameter sets for `dev` and `prd`.

## Naming

- Resource names now follow `{type}-{purpose}-{environment}` where Azure naming rules allow it.
- Shared singleton resources use `ec` as the purpose, for example `law-ec-dev` and `cae-ec-prd`.
- Resources with a specific runtime purpose use that purpose, for example `aca-api-dev`, `aca-sandbox-prd`, `acj-hands-dev`, and `uai-scheduler-prd`.
- Global-name exceptions such as ACR and Storage compact the same parts without hyphens and add a short uniqueness suffix, for example `acrecdevabc12` and `stecprdabc12`.

## Deployment Entry Points

Build the composition:

```powershell
az bicep build --file infra/environments/main.bicep
```

Validate a parameter file:

```powershell
az bicep build-params --file infra/environments/dev.bicepparam
```

Run a deployment or what-if:

```powershell
az deployment group what-if `
  --resource-group <resource-group> `
  --parameters infra/environments/dev.bicepparam

az deployment group create `
  --resource-group <resource-group> `
  --parameters infra/environments/dev.bicepparam
```

## Output Contract

The top-level template emits the values later steps need for runtime wiring:

- `apiBaseUrl`
- `sandboxInternalUrl`
- `containerRegistryLoginServer`
- `cosmosEndpoint`
- `cosmosDatabaseName`
- `storageAccountName`
- `uploadsContainerName`
- `artifactsContainerName`
- `blobEndpoint`
- `keyVaultUri`
- `credentialEncryptionKeyId`
- `applicationInsightsConnectionString`
- `foundryEndpoint`
- `foundryMemoryStoreEndpointOrId`
- `defaultModelDeploymentName`
- `memoryChatDeploymentName`
- `memoryEmbeddingDeploymentName`
- `workloadIdentities`
- `handsJobName`
- `schedulerJobName`

## Secret Flow Contract

- Managed identity is the default access path for Cosmos DB, Storage, Key Vault, and registry pulls.
- Key Vault stores platform-level secrets and the application credential-encryption key.
- Container Apps and Jobs receive secrets through Key Vault-backed secret references. The committed parameter files keep those arrays empty so no secret URIs or values are stored in source control.
- Non-secret settings such as service endpoints, database names, and telemetry connection strings are injected as plain environment variables from deployment outputs.

## Foundry Notes

- `create` mode is the default in the committed parameter files and provisions the Azure AI Services account, Foundry project, and default model deployment contract inside this deployment boundary.
 - `attach` mode remains available for subscriptions where Foundry resources are provisioned elsewhere.
 - Step 17 expects a chat deployment and an embedding deployment to be available for Memory Store creation; `attach` mode callers must provide both deployment names when they differ from the default chat deployment.
 - The committed `create` path now enables a system-assigned identity on the AI Services account and grants both the account identity and the project identity `Cognitive Services OpenAI User` on that account so Memory Store can invoke the configured model deployments.
- Memory store creation is still parameterized even in `create` mode because a stable ARM surface for that resource path has not been confirmed for this repo yet.

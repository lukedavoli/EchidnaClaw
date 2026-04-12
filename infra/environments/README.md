# Environments

- `main.bicep` composes the full Step 3 resource skeleton at resource-group scope.
- `dev.bicepparam` and `prd.bicepparam` capture environment-specific sizing, image tags, Foundry attachment details, and scheduler settings.
- Add secret reference overrides outside source control when a workload needs Key Vault-backed runtime secrets.

# Environments

`main.bicep` is the shared resource-group deployment entrypoint for EchidnaClaw infrastructure.

The checked-in `.bicepparam` files currently focus on the Foundry contract introduced in Phase 4 of the Step 3 infrastructure plan:

- `dev.bicepparam`
- `test.bicepparam`
- `prod.bicepparam`

Each parameter file defaults to `attach` mode so teams can wire the platform to an existing Azure AI Foundry estate without waiting for resource provisioning decisions. Switch `foundryMode` to `create` when the subscription is intended to own the Foundry account and project.

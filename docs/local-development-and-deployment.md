# Local Development And Deployment Workflows

## Environment Matrix

| Mode             | Intended use                                                   | Required settings                                                                       |
| ---------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `local-minimal`  | Fast inner-loop development with all four apps running locally | Local process settings only                                                             |
| `shared-cloud`   | Local apps using shared Azure dependencies                     | Local process settings plus the shared-cloud variables in `.env.local`                  |
| `cloud-deployed` | Container deployment environments                              | The same shared-cloud contract, supplied by the deployment environment and secret store |

The repository loads root `.env` and `.env.local` files through `@echidna-claw/config`. Shared-cloud mode intentionally fails fast if any of the reserved Azure resource settings are missing.

## Command Surface

- `pnpm dev` starts the local process loop for `apps/web`, `apps/api`, `apps/hands`, and `apps/sandbox`.
- `pnpm dev:smoke --local` verifies the local or Compose-backed stack shape after startup.
- `pnpm dev:smoke --deployed` verifies a deployed environment by using `ECHIDNA_WEB_PUBLIC_BASE_URL`, `ECHIDNA_API_PUBLIC_BASE_URL`, and `ECHIDNA_SANDBOX_BASE_URL` when present.
- `pnpm verify` runs lint, typecheck, tests, and builds.
- `pnpm docker:build` builds the four deployable images with deterministic tags.
- `pnpm compose:up` starts the Compose integration stack.
- `pnpm compose:down` tears the Compose stack down.

## Local URLs

Process loop defaults:

- web: `http://127.0.0.1:5173`
- API health: `http://127.0.0.1:3001/healthz`
- sandbox health: `http://127.0.0.1:3002/healthz`
- Hands liveness: `${TMPDIR}/echidna-claw/hands-liveness.json` unless overridden

Compose defaults:

- web: `http://127.0.0.1:4173`
- API health: `http://127.0.0.1:3001/healthz`
- sandbox health: `http://127.0.0.1:3002/healthz`
- Hands liveness: `.compose/hands/hands-liveness.json`

## Shared-Cloud Contract

When `ECHIDNA_RUNTIME_MODE` is `shared-cloud` or `cloud-deployed`, the following variables become required:

- `ECHIDNA_WEB_PUBLIC_BASE_URL`
- `ECHIDNA_OPERATOR_OBJECT_ID`
- `ECHIDNA_TRUSTED_USER_OBJECT_IDS`
- `ECHIDNA_COSMOS_DB_ENDPOINT`
- `ECHIDNA_COSMOS_DB_DATABASE_NAME`
- `ECHIDNA_COSMOS_DB_CREDENTIAL_SCOPE`
- `ECHIDNA_BLOB_STORAGE_ACCOUNT_URL`
- `ECHIDNA_BLOB_STORAGE_UPLOADS_CONTAINER`
- `ECHIDNA_BLOB_STORAGE_ARTIFACTS_CONTAINER`
- `ECHIDNA_KEY_VAULT_URI`
- `ECHIDNA_KEY_VAULT_KEY_ID`
- `ECHIDNA_FOUNDRY_PROJECT_NAME`
- `ECHIDNA_FOUNDRY_PROJECT_ENDPOINT`
- `ECHIDNA_MONITOR_CONNECTION_STRING`

For the API process in shared-cloud or cloud-deployed mode, the following additional variables are required:

- `ECHIDNA_API_PUBLIC_BASE_URL`
- `ECHIDNA_SANDBOX_BASE_URL`
- `ECHIDNA_HANDS_JOB_TARGET`
- `ECHIDNA_FOUNDRY_DEFAULT_DEPLOYMENT_NAME`
- `ECHIDNA_FOUNDRY_MEMORY_CHAT_DEPLOYMENT_NAME`
- `ECHIDNA_FOUNDRY_MEMORY_EMBEDDING_DEPLOYMENT_NAME`
- `ECHIDNA_TELEGRAM_WEBHOOK_SECRET_TOKEN`
- `ECHIDNA_INTERNAL_RUNTIME_AUTH_TOKEN`

Developer-provided values belong in `.env.local`. Pipeline-provided values should come from GitHub environments and the eventual deployment secret store.

## CI And Deployment Workflows

- `.github/workflows/ci.yml` runs on pushes to `feature/*`, pushes to `main`, and pull requests targeting `main`.
- The CI workflow now also starts the packaged Compose stack, runs `pnpm dev:smoke --local`, and executes the scheduler container once to validate branch builds against the packaged service topology.
- `.github/workflows/build-and-package.yml` centralizes image build and optional publish behavior.
- `.github/workflows/deploy-feature.yml` maps `feature/*` pushes to the `development` GitHub environment.
- `.github/workflows/deploy-main.yml` maps `main` pushes to the `production` GitHub environment.

Image publishing remains conditional. If registry settings or credentials are absent, the deployment workflows stop after packaging and leave a stub message for the later Step 3 infrastructure hookup.

## Smoke Check Modes

- Local process loop: `pnpm dev:smoke --local`
- Compose stack: `VITE_APP_BASE_URL=http://127.0.0.1:4173 pnpm dev:smoke --local`
- Deployed environment: `pnpm dev:smoke --deployed`

Deployed smoke checks require:

- `ECHIDNA_WEB_PUBLIC_BASE_URL`
- `ECHIDNA_API_PUBLIC_BASE_URL`
- `ECHIDNA_SANDBOX_BASE_URL` if sandbox health and sandbox execution should be checked
- `ECHIDNA_INTERNAL_RUNTIME_AUTH_TOKEN` if sandbox execution should be checked

If only public health endpoints are available, set `ECHIDNA_SMOKE_SKIP_SANDBOX_EXEC=true` and run the deployed smoke in health-only mode.

## Branch Protection Expectations

`main` is the protected production branch. Repository settings should enforce:

- pull requests required before merge
- CI required before merge
- at least one approving review required
- direct pushes disabled
- force pushes disabled

These settings are not fully expressible in repository files, so they must also be configured in the GitHub repository branch protection UI.

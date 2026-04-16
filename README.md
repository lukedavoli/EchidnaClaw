# EchidnaClaw

EchidnaClaw is a TypeScript monorepo for the v1 control plane, backend, worker, and sandbox services described in the design docs.

## Commands

- `pnpm install` installs all workspace dependencies.
- `pnpm dev` starts the local web, API, hands, and sandbox processes through Turborepo.
- `pnpm dev:smoke` checks the running local stack by probing web, API, sandbox, and the Hands liveness file.
- `pnpm verify` runs linting, type checking, tests, and builds for the full workspace.
- `pnpm docker:build` builds all four deployable app images from the repository root.
- `pnpm compose:up` starts the containerized integration stack with Docker Compose.
- `pnpm compose:down` stops the Compose stack and removes orphaned containers.

## Local Workflow

The fast inner loop remains `pnpm dev`. With the checked-in defaults, the process-based stack uses:

- web: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:3001/healthz`
- sandbox: `http://127.0.0.1:3002/healthz`
- Hands: liveness file written to the OS temp directory unless `ECHIDNA_HANDS_LIVENESS_FILE` is set

The containerized integration loop is `pnpm compose:up`. It serves the web container on `http://127.0.0.1:4173`, keeps API and sandbox on the same ports as the process loop, and writes the Hands liveness file to `.compose/hands/hands-liveness.json` for smoke verification from the host.

Copy `.env.example` to `.env.local` when you need to switch from `local-minimal` to `shared-cloud` mode or override any local defaults.

## Workspace Layout

- `apps/web` contains the React and Vite control plane shell.
- `apps/api` contains the API service shell.
- `apps/hands` contains the background worker shell.
- `apps/sandbox` contains the sandbox service shell.
- `packages/contracts` contains shared schemas, correlation metadata, and service contracts.
- `packages/domain` contains shared state machines and domain invariants.
- `packages/config` contains typed environment loading plus the checked-in repository config loader.
- `infra/` contains infrastructure placeholders and future Bicep modules.
- `scripts/` contains repository automation scripts.

## Environment And Deployment Policy

Step 4 establishes three explicit runtime shapes:

- `local-minimal` keeps all four apps local and requires only process-local settings.
- `shared-cloud` keeps the apps local while wiring remote Azure dependencies through environment variables.
- `cloud-deployed` is reserved for container deployments where the environment injects the same contract.

The supporting details live in [docs/local-development-and-deployment.md](docs/local-development-and-deployment.md), including the environment matrix, Compose usage, CI and deployment workflow behavior, and the required branch-protection settings for `main`.

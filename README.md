# EchidnaClaw

EchidnaClaw is a TypeScript monorepo for the v1 control plane, backend, worker, and sandbox services described in the design docs.

## Commands

- `pnpm install` installs all workspace dependencies.
- `pnpm dev` starts the local web, API, hands, and sandbox processes through Turborepo.
- `pnpm verify` runs linting, type checking, tests, and builds for the full workspace.
- `pnpm docker:build` builds all four deployable app images from the repository root.

## Workspace Layout

- `apps/web` contains the React and Vite control plane shell.
- `apps/api` contains the API service shell.
- `apps/hands` contains the background worker shell.
- `apps/sandbox` contains the sandbox service shell.
- `packages/config` contains typed environment loading.
- `packages/*` contains shared placeholder libraries for later steps.
- `infra/` contains infrastructure placeholders and future Bicep modules.
- `scripts/` contains repository automation scripts.

## Step 1 Baseline

Step 1 establishes a runnable, testable engineering baseline. It intentionally stops short of Step 2 domain contracts and any Azure integration logic.

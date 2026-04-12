# Step 01 Implementation Detail

## Objective
This plan implements only Step 1 from [docs/implementation-plan-v1.md](/C:/Users/ldavo/Repositories/Davoli%20Software/EchidnaClaw/docs/implementation-plan-v1.md) and stays aligned with the Delivery Model in [docs/system-design-v1.md](/C:/Users/ldavo/Repositories/Davoli%20Software/EchidnaClaw/docs/system-design-v1.md). The goal is to create a stable TypeScript monorepo baseline that later steps can build on without reworking repository structure, tooling, or config conventions.

## Scope
In scope:
- Root workspace setup for `apps/`, `packages/`, `infra/`, `docs/`, and `scripts/`
- Placeholder shells for `apps/web`, `apps/api`, `apps/hands`, and `apps/sandbox`
- Placeholder shared packages listed in the v1 implementation plan
- Shared TypeScript, lint, format, and unit test tooling
- Root task runner and per-project scripts
- Environment-variable conventions, `.env` templates, and typed config loading
- Dockerfiles for all deployable apps
- Basic developer bootstrap documentation

Out of scope:
- Domain schemas, state machines, and API contracts from Step 2
- Bicep modules or deployable Azure resources from Step 3
- CI/CD workflows, Docker Compose, and shared cloud-dev wiring from Step 4
- Real Telegram, Foundry, Cosmos DB, Key Vault, or Blob Storage integration
- Real product behavior beyond minimal health and placeholder startup surfaces

## Assumptions
- The repository currently contains only the v1 design and implementation docs.
- `pnpm` remains the package manager.
- Node.js `20 LTS` is the single local and container runtime baseline.
- The monorepo should be cross-platform; no Bash-only scripts.
- React + Vite is fixed for `apps/web`; backend framework selection is deferred, so Step 1 uses framework-light TypeScript shells.
- Step 1 should produce runnable placeholders, not speculative feature code.

## Execution Sequence
1. Create root metadata and repo hygiene files: `README.md`, `.gitignore`, `.gitattributes`, `.editorconfig`.
2. Add workspace control files: root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, root `tsconfig.json`, ESLint, Prettier, and Vitest config.
3. Scaffold `apps/`, `packages/`, `infra/`, and `scripts/` with the final path layout expected by later steps.
4. Create minimal `package.json`, `tsconfig.json`, `src/index.ts`, and placeholder tests for each app and package.
5. Add root scripts: `dev`, `build`, `lint`, `typecheck`, `test`, `clean`, and `docker:build`.
6. Add `packages/config` first and route all env access through it; no direct `process.env` reads elsewhere.
7. Add minimal Dockerfiles for `web`, `api`, `hands`, and `sandbox` using simple Node-based container builds.
8. Add placeholder runtime surfaces:
   - `web`: simple control-plane shell page
   - `api`: `GET /healthz`
   - `sandbox`: `GET /healthz`
   - `hands`: idle worker process with structured startup logging
9. Verify a clean clone can install, lint, typecheck, test, build, run `pnpm dev`, and build Docker images without cloud dependencies.

## Proposed Repository Structure
```text
/
├─ apps/
│  ├─ api/
│  ├─ hands/
│  ├─ sandbox/
│  └─ web/
├─ packages/
│  ├─ config/
│  ├─ contracts/
│  ├─ domain/
│  ├─ observability/
│  ├─ prompting/
│  └─ testing/
├─ infra/
│  ├─ environments/
│  ├─ modules/
│  └─ README.md
├─ scripts/
│  ├─ dev/
│  └─ docker/
├─ docs/
├─ .dockerignore
├─ .editorconfig
├─ .gitattributes
├─ .gitignore
├─ eslint.config.mjs
├─ package.json
├─ pnpm-workspace.yaml
├─ prettier.config.mjs
├─ tsconfig.base.json
├─ tsconfig.json
├─ turbo.json
└─ vitest.workspace.ts
```

## Tooling Choices
- Workspace orchestration: `pnpm` workspaces plus `turbo`
- TypeScript model: ESM everywhere, project references enabled, strict mode on
- TS compiler rules: enable `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `forceConsistentCasingInFileNames`
- Node app dev runner: `tsx`
- Node app/package build: `tsc --build`
- Web app dev/build: `Vite`
- Linting: `ESLint` flat config
- Formatting: `Prettier`
- Unit tests: `Vitest`
- Package boundaries: import shared code only through workspace package names such as `@echidna-claw/config`
- Git hooks: do not add Husky or similar in Step 1
- Containers: baseline Dockerfiles on `node:20-bookworm-slim`; the sandbox image can diverge later in Step 14

## Environment and Config Strategy
- Use one checked-in root `.env.example` in Step 1.
- Support untracked `.env.local` and `.env.test` files for local overrides.
- Use namespaced variables only:
  - `ECHIDNA_API_*`
  - `ECHIDNA_HANDS_*`
  - `ECHIDNA_SANDBOX_*`
  - `VITE_*` for browser-safe values
- Configure Vite to expose only `VITE_*`.
- `packages/config` owns all env schemas and loaders, using typed validation with `zod`.
- Startup should fail fast on missing or invalid required config.
- Root `README.md` should document default local ports and startup commands.
- Default local ports:
  - `web`: `5173`
  - `api`: `3000`
  - `sandbox`: `3002`
  - `hands`: no fixed port
- Use the same env names locally and in cloud deployment later; do not create separate naming schemes.

## Test and Verification Strategy
- Add one smoke test proving Vitest is wired correctly in the workspace.
- Add config-loader tests for valid env, missing required env, and invalid env.
- Add placeholder startup tests where practical for `api`, `hands`, and `sandbox`.
- Manual verification commands for Step 1:
  - `pnpm install`
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm build`
  - `pnpm dev`
  - `pnpm docker:build`
- Manual runtime checks:
  - `web` page renders
  - `api` health endpoint responds
  - `sandbox` health endpoint responds
  - `hands` starts cleanly and stays running
- Step 1 does not need coverage gates, integration tests, or end-to-end tests.

## Acceptance Criteria
- The repository has the final monorepo path layout expected by later steps.
- All planned apps and shared packages exist as workspace projects, even if implementation is placeholder-only.
- Root commands for `dev`, `build`, `lint`, `typecheck`, `test`, and `docker:build` work from a clean clone.
- Shared TypeScript, lint, format, and test configuration is centralized at the root.
- `packages/config` is the only allowed env access path.
- Each deployable app has a Dockerfile that builds successfully.
- `pnpm dev` starts all placeholder runtimes from one terminal.
- No Step 2 or later business logic is introduced under the guise of scaffolding.

## Risks
- Over-scaffolding later contracts too early can cause rework.
  Mitigation: keep placeholder packages thin and mark incomplete areas clearly.
- Cross-platform script failures are likely because the current environment is Windows while deployment is Linux.
  Mitigation: use `pnpm`, `turbo`, `tsx`, and Node-based scripts only.
- Dockerfiles can drift across apps.
  Mitigation: use the same stage pattern and naming in every Dockerfile from the start.
- Env sprawl can become hard to manage quickly.
  Mitigation: enforce namespaced variables and a single typed config package.
- Placeholder services can be mistaken for real runtime support.
  Mitigation: keep health/startup behavior explicit and avoid fake integrations.

## Doc Updates If Implementation Diverges
- If `turbo` is not used, update [docs/implementation-plan-v1.md](/C:/Users/ldavo/Repositories/Davoli%20Software/EchidnaClaw/docs/implementation-plan-v1.md) to state the actual root task runner.
- If the workspace package list changes from the current `packages/*` assumption, update the assumptions section in `docs/implementation-plan-v1.md`.
- If Step 1 introduces CI workflows or Docker Compose, move that scope forward from Step 4 in `docs/implementation-plan-v1.md`.
- If env templates become per-app instead of a single root template, document the exact loading order here and in the later local-development docs.
- If the sandbox needs a distinct base image immediately, update the Delivery Model wording in [docs/system-design-v1.md](/C:/Users/ldavo/Repositories/Davoli%20Software/EchidnaClaw/docs/system-design-v1.md) only if that materially changes local dev or deployment shape.

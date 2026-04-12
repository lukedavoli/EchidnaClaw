# Step 01 Implementation Report

## Summary

Step 1 is implemented as a working TypeScript monorepo baseline for EchidnaClaw.

The repository now includes:

- `pnpm` workspaces and a Turborepo task graph
- strict shared TypeScript, ESLint, and Prettier configuration
- runnable `api`, `hands`, `sandbox`, and `web` app shells
- typed runtime config loading in `packages/config`
- placeholder shared packages for later steps
- per-app Dockerfiles plus a root `pnpm docker:build` helper
- root `.env.example` and local `.env` support

## Key Decisions

- The baseline uses Node.js 20 LTS for the local and container runtime.
- Browser-safe config loading is isolated behind `@echidna-claw/config/browser`.
- The Node service images run their entrypoints from source with `tsx` in Step 1, while workspace build validation still compiles the codebase separately through `pnpm build`.

## Verification

The final workspace state passed:

- `pnpm install`
- `pnpm verify`
- `pnpm docker:build`

Live smoke tests also passed:

- API `GET /healthz` returned `{"environment":"development","service":"api","status":"ok"}`
- Sandbox `GET /healthz` returned `{"environment":"development","service":"sandbox","status":"ok"}`
- Web preview served HTTP 200 and rendered `EchidnaClaw Control Plane`
- Hands worker started and logged its readiness plus heartbeat interval

# EchidnaClaw Implementation Plan v1

## Purpose

This document translates `docs/system-design-v1.md` into a concrete implementation plan. It is written for a Codex-led delivery model where the full v1 system will be implemented in this repository, with parallel Codex threads used only when ownership boundaries are clear and the work is not blocked by unfinished dependencies.

The plan stays inside the explicit v1 boundaries from the system design. It assumes no additional scope such as browser automation, file uploads, multi-user auth, direct inter-agent communication, or a dedicated indexed knowledge base.

## Working Implementation Assumptions

To keep implementation concrete and avoid redesign during delivery, the following assumptions should be treated as the default unless a later task proves they need to change:

- The repository will become a TypeScript monorepo with `apps/` and `packages/` workspaces.
- The main workspace layout will be:
  - `apps/web` for the React and Vite control plane
  - `apps/api` for the main API, Telegram adapter, Head entrypoints, and admin endpoints
  - `apps/hands` for Hands job execution code
  - `apps/sandbox` for the execution sandbox service
  - `packages/domain` for domain models, state machines, and schema definitions
  - `packages/contracts` for API, tool, and integration contracts
  - `packages/config` for versioned policy and pricing configuration
  - `packages/prompting` for shared prompt layering and memory policy helpers
  - `packages/observability` for logging, tracing, and correlation helpers
  - `packages/testing` for test fixtures and end-to-end helpers
- `pnpm` workspaces will be used for package management.
- Shared schemas will be defined once and reused everywhere to prevent drift between web, API, Head, Hands, and sandbox layers.
- Azure infrastructure will be defined with modular Bicep templates.
- Cosmos DB will be the source of truth for exact platform state, while Foundry Memory Store will be used only for durable conversational memory.
- The implementation will prefer simple, explicit service boundaries over generic framework-heavy abstractions.

## Delivery Strategy

### Serialization Points

The following areas are shared choke points and should be implemented in a single thread until stable:

- monorepo structure and base tooling
- shared domain models and contracts
- repository-wide configuration and environment loading
- Bicep module interfaces
- Head-to-Hands task envelope format
- sandbox tool contract

### Safe Parallel Workstreams

Once the serialization points above are stable, implementation can split into parallel Codex threads with disjoint ownership:

| Workstream | Primary ownership | Typical paths |
| --- | --- | --- |
| Foundation | workspace, shared packages, config, CI | `package.json`, workspace files, `packages/domain`, `packages/contracts`, `packages/config` |
| Infrastructure | Bicep modules and deployment wiring | `infra/` |
| Control plane backend | API routes, admin services, Telegram adapter, Head orchestration | `apps/api`, selected shared packages only when coordinated |
| Web UI | agent management and analytics UI | `apps/web` |
| Hands runtime | queue execution, task handlers, reconciliation | `apps/hands` |
| Sandbox runtime | session execution service and guardrails | `apps/sandbox` |
| Ops and analytics | tracing, usage accounting, dashboards, smoke tests | `packages/observability`, selected slices of `apps/api` and `apps/web` |

### Parallel Execution Waves

The recommended delivery rhythm is:

1. Single-thread foundation work until the monorepo, contracts, and core state models are stable.
2. Split into parallel threads for infrastructure, API skeleton, and web shell.
3. Split again into parallel threads for Telegram and Head runtime, Hands runtime, and sandbox service once task contracts are frozen.
4. Run approvals, scheduling, analytics, and UI completion in parallel once the core runtime paths are working.
5. Re-converge for end-to-end hardening, test repair, and release readiness.

## Step-by-Step Plan

### Step 1. Bootstrap the Monorepo and Engineering Baseline

Overview:
Create the repository structure and baseline tooling that every later implementation step will rely on.

Requirements:

- Initialize the workspace structure for `apps/`, `packages/`, `infra/`, and `docs/`.
- Set up `pnpm` workspaces, shared TypeScript configuration, linting, formatting, and unit test tooling.
- Add a root command surface so the full stack can eventually be started from one terminal.
- Add Dockerfiles and shared dev scripts for all deployable apps.
- Establish environment variable conventions, `.env` templates, and runtime config loading rules.

Outcome:

- The repository has a stable, repeatable development skeleton.
- Later Codex threads have clear write boundaries and common tooling.

Parallelization:

- Do not split work before this step is complete.

### Step 2. Define Shared Domain Models, State Machines, and Contracts

Overview:
Create the shared language of the system before building individual services.

Requirements:

- Define schemas for agents, channels, inbound messages, outbound messages, working context, tasks, task envelopes, approvals, schedules, artifacts, credentials, usage events, and run journals.
- Define explicit state machines for tasks, approvals, agent provisioning, and soft-delete lifecycle.
- Define correlation identifiers and metadata needed to connect messages, Head turns, Hands jobs, sandbox sessions, and analytics.
- Define service interfaces for the Head, Hands, sandbox, scheduler, and web control plane.
- Define versioned repository config for model pricing, sandbox policy, package allowlists, and capability registry data.

Outcome:

- Every later component builds against the same contracts.
- The highest-risk interface drift is removed early.

Parallelization:

- This step is still effectively single-threaded.
- Downstream threads should wait until the initial contract set is stable.

### Step 3. Define the Infrastructure-as-Code Skeleton

Overview:
Create the Bicep module layout and deployment composition that matches the system design.

Requirements:

- Create Bicep modules for foundational resources, application hosting, data and storage resources, messaging and channel resources, and observability.
- Model Azure Container Apps for the API, Hands jobs, recurring scheduler job, and sandbox service.
- Model Cosmos DB, Blob Storage, Key Vault, Foundry resources, managed identities, and Application Insights.
- Define environment-specific parameters and outputs so applications can be wired without hand-edited deployment steps.
- Establish secret flow expectations between Key Vault, Container Apps, and application settings.

Outcome:

- Infrastructure can be deployed repeatedly from code.
- Service boundaries are reflected in infrastructure rather than hidden in ad hoc scripts.

Parallelization:

- Can run in parallel with Step 4 once Step 2 contracts are stable.

### Step 4. Establish Local Development and Deployment Workflows

Overview:
Make local and cloud development predictable before deeper feature work begins.

Requirements:

- Create one-command local startup for the web app, API, Hands runtime, and sandbox service.
- Add Docker Compose or equivalent local orchestration for the deployable services.
- Wire shared cloud development resources where local emulators are not desirable.
- Create CI checks for linting, type checking, unit tests, and build validation.
- Create the initial branch-driven deployment pipeline skeleton and protected production branch expectations.

Outcome:

- Codex can iterate against the intended app shape locally.
- Deployment automation exists early enough to avoid late integration surprises.

Parallelization:

- Can run in parallel with Step 3.
- Keep ownership inside tooling, CI, and container orchestration files to avoid overlap with app feature work.

### Step 5. Implement the Core Persistence Layer

Overview:
Build the data access layer for Cosmos DB, Blob Storage metadata, and encrypted credential storage.

Requirements:

- Define Cosmos container strategy, partition keys, indexing expectations, and optimistic concurrency patterns.
- Implement repositories for agent records, message log, working context, task queue, approvals, run journals, schedules, credentials, artifacts, idempotency records, and usage events.
- Implement Blob artifact metadata persistence and retention metadata handling.
- Implement encryption and decryption boundaries for per-agent credentials stored in Cosmos DB with Key Vault-managed keys.
- Add repository-level tests for concurrency, idempotency, and state transitions.

Outcome:

- The platform has deterministic persistence primitives for every exact-state concern in the design.
- Higher layers can focus on workflow logic instead of raw storage access.

Parallelization:

- Can begin after Steps 2 and 3.
- Should be owned by a single thread until the repository APIs settle.

### Step 6. Build the Main API and Control-Plane Service Skeleton

Overview:
Create the main backend application that will host admin APIs, Telegram webhooks, Head entrypoints, and runtime orchestration.

Requirements:

- Stand up the API application with health checks, config loading, DI or service registration, and error handling.
- Create placeholder route groups for admin APIs, Telegram webhook ingress, outbound messaging, approval callbacks, and internal runtime endpoints.
- Implement clients and wrappers for Foundry, Cosmos repositories, Key Vault access, Blob access, and job-start triggers.
- Add correlation-aware logging and request context propagation from the start.
- Keep the application modular so Head logic, channel adapters, and admin endpoints remain separable.

Outcome:

- There is a running backend shell ready to host the core runtime.
- Later runtime features plug into a stable service container instead of growing ad hoc.

Parallelization:

- Can begin after Step 2.
- Can run in parallel with Step 5 and Step 7 if contracts are stable.

### Step 7. Build the Web Control Plane Shell

Overview:
Implement the React and Vite web UI for agent management and analytics.

Requirements:

- Build the base layout, routing, API client layer, and error states.
- Implement list, create, soft-delete, and status surfaces for agents.
- Reserve UI flows for provisioning status, retry actions, and jump-to-conversation links.
- Implement analytics views using existing charting and component libraries rather than custom primitives.
- Keep refresh behavior explicit rather than polling or real-time streaming.

Outcome:

- The control plane exists early and can evolve alongside the backend.
- Agent lifecycle and analytics surfaces have a clear home.

Parallelization:

- Can run in parallel with Steps 5 and 6 after API contracts are outlined.

### Step 8. Implement the Agent Registry and Provisioning Lifecycle

Overview:
Build the data model and service logic for agent creation, pending provisioning, recovery, activation, and retirement.

Requirements:

- Implement factory-default agent creation from a user-supplied name.
- Support provisioning states such as pending, failed, active, and soft-deleted.
- Store channel metadata, bot identity details, timestamps, and recovery metadata.
- Implement soft-delete behavior that removes agents from active views while preserving history and memory.
- Expose service methods and admin endpoints needed by the web UI and Telegram binding flow.

Outcome:

- Agents become first-class platform objects with stable lifecycle handling.
- The system can represent incomplete Telegram provisioning without losing track of the agent.

Parallelization:

- Can run after Steps 5, 6, and 7.
- Avoid parallel edits to shared agent schemas unless coordinated.

### Step 9. Implement the Telegram Channel Adapter

Overview:
Build the first channel integration around Telegram inbound and outbound messaging.

Requirements:

- Validate and normalize Telegram webhook payloads.
- Resolve the target agent and trusted messaging identity from channel context.
- Persist inbound events immutably before Head processing.
- Deduplicate retries by Telegram update identifier and assign the next per-agent message sequence.
- Implement outbound message sending and action-oriented approval controls.

Outcome:

- Telegram becomes a reliable, durable messaging surface instead of a thin webhook pass-through.
- Message ordering and idempotency guarantees are in place before Head orchestration depends on them.

Parallelization:

- Can run in parallel with Step 10 once the core message contracts and agent registry APIs are stable.

### Step 10. Implement the Head Runtime and Prompt Layering

Overview:
Build the conversational orchestration layer on top of Foundry Agent Service.

Requirements:

- Implement the Head runtime wrapper around Foundry prompt agents using `gpt-5.4-mini`.
- Apply layered instructions for platform policy, shared EchidnaClaw base behavior, and mutable per-agent guidance.
- Implement trusted-channel enforcement so instructions from other surfaces cannot steer the agent.
- Build the tool surface the Head needs for task creation, schedule changes, memory operations, approvals, status reads, and sandbox invocation where appropriate.
- Add the user-facing capability skill behavior that is shown only when the user asks about capabilities.

Outcome:

- The platform has a managed conversational runtime that can interpret user intent and due-task triggers.
- Prompt behavior is centralized and versioned instead of scattered through route handlers.

Parallelization:

- Can run in parallel with Step 9 once service contracts are stable.
- Keep prompt packages and shared Head contracts under coordinated ownership.

### Step 11. Implement Working Context, Episode Rotation, and Supersession Control

Overview:
Make the Head safe under concurrent inbound events and long-running conversation history.

Requirements:

- Implement per-agent latest inbound sequence, latest processed sequence, and active Head turn tracking.
- Implement stale-turn detection so an older Head response cannot emit messages or side effects after a newer trusted message arrives.
- Implement the optional short debounce window for rapid message bursts.
- Implement rolling episode logic that keeps only the current calendar day and at most 20 turns in active context.
- Refresh working-context summaries after every user message and significant Hands state change.

Outcome:

- The conversation model remains coherent without relying on a permanent transcript window.
- Stale Head replies and duplicate downstream work are blocked before they reach the user.

Parallelization:

- This step touches shared Head runtime logic and should stay mostly single-threaded.

### Step 12. Implement the Task Envelope, Queue, and Run Journal Model

Overview:
Create the durable handoff layer between the Head and the Hands.

Requirements:

- Implement structured task envelopes with requested outcome, task type, priority, due time, approval status, references, and optional notes.
- Implement the task state machine for queued, running, waiting for user, completed, failed, cancelled, and deferred.
- Implement run journal records and progress-summary structures that the Head can read later.
- Implement duplicate detection and merge logic for obvious follow-up tasks.
- Implement conservative retry and idempotency behavior for queued work and job-start requests.

Outcome:

- The Head can hand work to the Hands through durable, inspectable records rather than in-memory state.
- Status reporting and future reconciliation become possible.

Parallelization:

- Can run in parallel with Step 13 once the task contracts are stable.

### Step 13. Implement the Hands Worker Runtime

Overview:
Build the background execution runtime that processes queued work.

Requirements:

- Implement job startup, task claiming, concurrency control, and one-active-run-per-agent enforcement.
- Implement task handlers that perform work, update progress, and write completion or failure state.
- Implement safe cancellation checkpoints between major tool invocations and side-effecting steps.
- Support follow-up task creation, deferred work, and waiting-for-user transitions.
- Ensure the Hands never own the user-facing conversation directly and instead report structured results back to platform state.

Outcome:

- The system can execute background work independently of live chat turns.
- Task execution respects the Head-and-Hands split instead of collapsing into one process.

Parallelization:

- Can run in parallel with Step 14 after the task and sandbox contracts are frozen.

### Step 14. Implement the Execution Sandbox Service

Overview:
Build the terminal-like execution environment used by the platform for shell, CLI, SDK, and HTTP work.

Requirements:

- Implement short-lived isolated sessions with their own working directories.
- Enforce resource limits for time, CPU, memory, and output size.
- Enforce filesystem and network guardrails, including blocked destinations and sensitive paths.
- Implement approved package-manager and package-allowlist policy for on-demand installs.
- Implement scoped runtime credential injection, audit logging, and structured command results.

Outcome:

- The platform gains practical execution capability without giving the Head or Hands direct uncontrolled shell access.
- Sandbox behavior is policy-driven and testable.

Parallelization:

- Can run in parallel with Step 13 after the tool contract is stable.
- Keep sandbox-specific code isolated to avoid cross-thread overlap.

### Step 15. Implement the Unified Scheduling and Due-Task Pipeline

Overview:
Build the recurring and future-dated task system that routes back through the Head.

Requirements:

- Implement structured schedule storage with original natural-language request plus normalized recurrence.
- Implement per-agent timezone handling for schedule interpretation and due-time evaluation.
- Implement a shared recurring scheduler job that polls for due tasks and enqueues them.
- Support one-off future tasks, follow-up checks, reminder tasks, and administrative due tasks through the same pipeline.
- Ensure every due task goes through the Head first before the Hands are invoked.

Outcome:

- Scheduled work behaves like the system design describes rather than as a separate special-case runtime.
- The Head remains the decision point for proactive behavior.

Parallelization:

- Can run in parallel with Step 16 after the Head and task pipeline are stable.

### Step 16. Implement Approvals and Credential Lifecycle Management

Overview:
Build the trust boundary for side-effecting actions and reusable per-agent credentials.

Requirements:

- Implement approval request records linked to originating tasks.
- Implement concise Telegram approval prompts with explicit approve and reject controls.
- Support pending approvals without compute staying active.
- Enforce action-specific confirmation for high-risk categories such as sending, deleting, purchases, credential changes, and bulk updates.
- Implement guided credential capture, storage, status display, revoke, replace, and scoped sandbox injection flows.

Outcome:

- The platform can safely block on user consent and resume later.
- Credentials become manageable platform state instead of ad hoc secrets in messages.

Parallelization:

- Can run in parallel with Step 15 and Step 18 once core runtime primitives exist.

### Step 17. Integrate Foundry Memory Store and Memory Policy

Overview:
Separate durable conversational memory from operational state.

Requirements:

- Implement per-agent memory scope resolution tied to the trusted messaging identity and agent boundary.
- Implement policy-driven memory writes for stable preferences, standing instructions, durable facts, recurring patterns, and long-lived guidance.
- Keep operational scratch state, active task state, and queue details out of long-term memory.
- Implement normal conversational correction and refinement of memory rather than a separate admin surface.
- Ensure working-context summaries and Memory Store usage remain clearly distinct.

Outcome:

- Agents retain durable context across conversations without polluting memory with workflow internals.
- The system design's storage boundaries are preserved in code.

Parallelization:

- Can run in parallel with late-stage runtime work once the Head interface is stable.

### Step 18. Implement Observability, Audit History, and Usage Accounting

Overview:
Build the operational visibility and analytics backbone for the system.

Requirements:

- Add tracing and log correlation across inbound messages, Head turns, task envelopes, Hands jobs, sandbox sessions, approvals, and final outcomes.
- Persist audit history for tool calls, sandbox commands, due-task processing, approval events, and run outcomes with the required retention policy.
- Ingest provider-reported usage events and store normalized raw usage data.
- Implement pricing configuration and aggregate cost estimation logic per model and per agent.
- Expose backend analytics endpoints for total usage, per-agent usage, and time-series views across common reporting windows.

Outcome:

- The platform is debuggable and usage-aware.
- The web UI can show trustworthy analytics without duplicating aggregation logic in the frontend.

Parallelization:

- Can run in parallel with Step 19 once core runtime identifiers and usage hooks exist.

### Step 19. Complete the Web Control Plane

Overview:
Finish the web UI against the real backend once the lifecycle and analytics systems exist.

Requirements:

- Connect agent creation, soft-delete, status, provisioning, and retry flows to real APIs.
- Surface per-agent channel status, provisioning state, and jump-to-conversation affordances.
- Implement analytics pages against the aggregate analytics endpoints.
- Hide soft-deleted agents from normal active views while preserving access paths intended for reference or recovery.
- Finalize minimal but clean UX for the v1 single-user control plane.

Outcome:

- The web UI becomes the actual operational control plane described in the system design.
- The platform is manageable without relying on hidden scripts or direct database edits.

Parallelization:

- Can run in parallel with Step 18 after API contracts settle.

### Step 20. Add Telegram Provisioning Handoff and Recovery Flow

Overview:
Complete the gap between agent creation and a live Telegram bot identity.

Requirements:

- Implement the operator-facing handoff that starts Telegram bot provisioning from the web UI.
- Persist provisioning checkpoints and failure states.
- Implement backend binding completion once the new bot is reachable and verified.
- Support retry and recovery without creating duplicate agents.
- Keep all Telegram-specific provisioning behavior inside the Telegram adapter boundary.

Outcome:

- New agents can be created through the intended v1 path without leaking Telegram setup details into unrelated parts of the system.
- Provisioning failures remain recoverable and visible.

Parallelization:

- Can run in parallel with Step 19 if agent lifecycle APIs are already in place.

### Step 21. Harden Failure Modes, Testing, and Release Readiness

Overview:
Turn the implemented system into a releasable v1 platform.

Requirements:

- Add integration and end-to-end tests for inbound deduplication, stale-turn suppression, task queue transitions, Hands execution, scheduler routing, approvals, and credential flows.
- Add sandbox policy tests for denied commands, denied filesystem targets, denied destinations, and allowed package installation paths.
- Add smoke tests for deployed environments and branch-based pipeline validation.
- Verify retention and cleanup behavior for artifacts, audit history, and usage events.
- Create runbooks for failed provisioning, stuck queued work, failed Hands jobs, credential revocation, and partial external side effects after cancellation.

Outcome:

- The system is stable enough to deploy and operate as a v1 product.
- Known operational failure paths have explicit detection and recovery procedures.

Parallelization:

- Test implementation can be split by subsystem, but final stabilization and release sign-off are serialized.

## Recommended Milestones

### Milestone A: Foundation Ready

Complete Steps 1 through 6.

Exit criteria:

- Monorepo structure is stable.
- Shared contracts are in place.
- Infrastructure and local development loops exist.
- Persistence and API skeletons are running.

### Milestone B: Conversational Agent MVP

Complete Steps 7 through 11 and Step 17.

Exit criteria:

- Agents can be created and tracked.
- Telegram messages reach the platform and are persisted.
- The Head can reply safely with proper supersession handling.
- Working context and memory boundaries are functioning.

### Milestone C: Background Execution MVP

Complete Steps 12 through 16.

Exit criteria:

- The Head can enqueue durable work.
- Hands jobs can execute tasks and report progress.
- The sandbox is callable under guardrails.
- Schedules, due tasks, approvals, and credentials work end to end.

### Milestone D: Operable v1 System

Complete Steps 18 through 21.

Exit criteria:

- Analytics and observability are available.
- The web control plane is usable for real operations.
- Telegram provisioning is recoverable.
- Deployment, testing, and runbooks support a production release.

## Recommended Parallel Thread Plan for Codex

Use this table as the execution map for Codex threads. A step is unblocked when every item in `Depends on` is stable enough to act as a contract boundary; once unblocked, rows with disjoint write scopes can be executed in parallel.

| Step | Scope | Depends on | Unblocked / parallel note |
| --- | --- | --- | --- |
| 1 | Bootstrap the monorepo and engineering baseline | None | Start immediately and keep single-threaded. |
| 2 | Define shared domain models, state machines, and contracts | 1 | Start after the workspace and tooling layout from Step 1 is frozen. |
| 3 | Define the infrastructure-as-code skeleton | 2 | Start after Step 2 stabilizes; run in parallel with Step 4. |
| 4 | Establish local development and deployment workflows | 2 | Start after Step 2 stabilizes; keep ownership inside tooling, CI, and orchestration files so it can run in parallel with Step 3. |
| 5 | Implement the core persistence layer | 2, 3 | Start after contracts and infrastructure assumptions are stable; keep mostly single-threaded until repository APIs settle. |
| 6 | Build the main API and control-plane service skeleton | 2 | Start after service contracts stabilize; can run in parallel with Steps 5 and 7. |
| 7 | Build the web control plane shell | 2, initial API contract outline from 6 | Start once the frontend has a stable API shape to target; can continue in parallel with Steps 5 and 6. |
| 8 | Implement the agent registry and provisioning lifecycle | 5, 6, 7 | Start once persistence, backend shell, and initial UI flow all exist. |
| 9 | Implement the Telegram channel adapter | 5, 6, 8 | Start once agent registry APIs and message persistence are stable; can run in parallel with Step 10. |
| 10 | Implement the Head runtime and prompt layering | 5, 6, 8 | Start once backend contracts and per-agent lifecycle surfaces are stable; can run in parallel with Step 9. |
| 11 | Implement working context, episode rotation, and supersession control | 9, 10 | Start once the live message path and Head runtime both work; keep mostly single-threaded. |
| 12 | Implement the task envelope, queue, and run journal model | 2, 5, 6 | Start once core contracts, persistence, and the main service shell are stable; can overlap with early Step 13 work after the task contract freezes. |
| 13 | Implement the Hands worker runtime | 12 | Start once the task envelope and queue model are stable; can run in parallel with Step 14. |
| 14 | Implement the execution sandbox service | 12 | Start once the sandbox and tool contract is stable; keep sandbox-specific code isolated so it can run in parallel with Step 13. |
| 15 | Implement the unified scheduling and due-task pipeline | 10, 12 | Start once Head routing and the task pipeline are stable; can run in parallel with Step 16. |
| 16 | Implement approvals and credential lifecycle management | 9, 12 | Start once the Telegram approval surface and task pipeline exist; can run in parallel with Steps 15 and 18. |
| 17 | Integrate Foundry Memory Store and memory policy | 10, 11 | Start once the Head interface and working-context boundaries are stable; can run alongside late runtime work. |
| 18 | Implement observability, audit history, and usage accounting | 9, 10, 12, 13, 14 | Start once the core runtime identifiers and usage hooks exist; can run in parallel with Step 19. |
| 19 | Complete the web control plane | 7, 8, 18 | Start once real lifecycle APIs and analytics endpoints are stable; can run in parallel with Step 20 if provisioning APIs already exist. |
| 20 | Add Telegram provisioning handoff and recovery flow | 7, 8, 9 | Start once the operator-facing web path, agent lifecycle, and Telegram adapter all exist; can continue in parallel with Step 19. |
| 21 | Harden failure modes, testing, and release readiness | 3, 4, 8-20 | Start subsystem tests as each slice lands, but final stabilization and release sign-off wait for the implemented runtime, UI, infra, and ops paths to converge. |

The key constraint is unchanged: parallelize only after interfaces are stable, and keep each thread's write scope narrow enough that merges remain mechanical rather than architectural.

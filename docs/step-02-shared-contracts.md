# Step 2 Shared Contracts and Domain Decisions

This document records the concrete Step 2 implementation choices for the EchidnaClaw v1 foundation.

## Package Boundaries

- `packages/contracts` owns the shared Zod schemas, inferred TypeScript types, correlation metadata, service request contracts, and repository config schema.
- `packages/domain` owns pure workflow logic: state transitions, concurrency guards, idempotency key helpers, and deterministic schedule occurrence calculation.
- `packages/config` owns runtime loading for environment variables and the checked-in repository config file at `config/repository.v1.json`.

## Record Model

The Step 2 contracts define persisted record shapes for:

- agents
- channels
- inbound messages
- outbound messages
- working context
- tasks
- task envelopes
- approvals
- schedules
- artifacts
- credential references
- usage events
- run journals and journal entries
- head turns
- hands runs
- sandbox sessions

Every record carries:

- `id`
- `recordType`
- `schemaVersion`
- `createdAt`
- `updatedAt`
- `correlation`

The correlation block is the canonical shared link surface for traces, idempotency keys, message lineage, Head turns, Hands runs, sandbox sessions, approvals, schedules, and analytics.

## Lifecycle Decisions

- Task lifecycle: `queued -> running -> waiting_for_user|completed|failed|cancelled|deferred`, with the other documented return paths preserved.
- Approval lifecycle: `requested -> approved|rejected|expired|cancelled`.
- Agent provisioning lifecycle: `pending_provisioning -> provisioning -> active|provisioning_failed`, with retries from `provisioning_failed`.
- Soft delete lifecycle: reversible between `active` and `soft_deleted`.

Additional Step 2 choices:

- `waiting_for_user` releases the active Hands slot.
- At most one active blocking approval is modeled per task.
- Restoring a soft-deleted agent does not backfill missed schedule occurrences.
- Credentials are metadata and access references only; raw secret material is not part of the shared contracts.
- Run journals and run journal entries are modeled as separate record types.

## Repository Config

The checked-in repository config is intentionally a single v1 file: `config/repository.v1.json`.

It currently defines:

- the default model and model pricing table
- sandbox policy metadata
- package allowlists
- capability registry entries

The initial pricing entry is a versioned repository value for analytics estimation. Later infrastructure and analytics work can swap in a more automated source without changing the Step 2 schema contract.

## Scheduling Semantics

The shared recurrence contract stores:

- original natural-language request on the schedule record
- a normalized recurrence object with `frequency`, `interval`, `timeZone`, and `anchorAt`
- optional `localTime` and `weekdays`

The Step 2 domain helper calculates the next occurrence deterministically from the anchored recurrence definition. Full scheduler materialization and cloud execution remain later steps.

# Testing

The repository uses Bun's native test runner. Keep tests deterministic, isolate mutable state, and prefer real local implementations over mocks when they are inexpensive and safe. Deployment-profile certification must distinguish **historical executable evidence** from **current release evidence**.

## Milestone ownership

- **M9** finishes and certifies the managed-cloud Railway + Neon + R2 + Restate profile.
- **M10** adds Local and Self-hosted deployment adapters/conformance.
- **M11** rebuilds the complete validation program into deterministic release lanes and independently reruns all three profiles.
- **M12** is the first live Agent HQ/optional Cortana cross-product release gate.

A historical M1–M9 test remains useful evidence, but it cannot certify a component after its architecture has been superseded. In particular, former AWS/ECS/Terraform and Temporal-specific tests do not prove the accepted Railway/Restate deployment.

## Current commands

The following commands describe the repository as it exists today. M9.7/M9.8/M10/M11 will update them as implementation changes land.

- `bun run test` builds once, then runs the current test groups.
- `bun run test:unit` runs colocated unit tests and coverage enforcement.
- `bun run test:integration` currently exercises PostgreSQL-backed integration boundaries and recovery fixtures. These PostgreSQL fixtures remain valid for server/cloud persistence testing but are not the M10 Local product database.
- `bun run test:e2e` runs the existing cross-package acceptance scenarios.
- `bun run test:smoke` runs repository policy, infrastructure, and service-bootstrap checks.
- `bun run test:foundation` runs the current foundation suite from a clean checkout.
- `bun run test:acceptance` runs the existing repository acceptance baseline.
- `bun run compatibility:check` validates machine-readable runtime compatibility evidence.
- `bun run test:m3-acceptance` through `test:m7-acceptance` preserve the historical feature acceptance seams.
- The M2-M6 acceptance flows remain available as historical feature acceptance evidence while M9/M10
  replace the deployment topology.
- `bun run test:m5-acceptance` runs the Runtime Gateway security, delivery, recovery, and protocol matrix.
- `bun run test:m9-acceptance` runs the existing production-hardening/security/load evidence. **It is not sufficient to close M9.6**: live Railway staging evidence is also required.
- `bun run test:recovery-matrix` runs current disposable recovery fixtures.

The Railway manifest validator checks repository-owned service composition. A green local validation is
not Railway staging evidence until the M9.6 live activation gate is completed.

## Required M9 validation additions

M9.7–M9.13 must leave a reproducible managed-cloud validation path covering:

- dependency-aware Railway service builds from a clean clone;
- repository-owned Railway service configuration;
- explicit Neon Drizzle migration and schema-version verification;
- least-privilege runtime versus migration database authority;
- Restate lifecycle/restart/redeploy/recovery;
- R2 adapter operations;
- Railway private service networking/public ingress boundaries;
- service authentication/secrets/configuration;
- health/readiness/draining;
- public schema/OpenAPI/SDK compatibility;
- deterministic Profile/Skill resolution;
- ContextProvider policy/cache/failure behavior;
- operational retry/heartbeat/expiry/retention/payload defaults;
- M9.1–M9.5 observability/security/recovery/performance evidence rerun against the real staging candidate.

M9.6 #73 closes only after the complete live cloud path passes.

## Required M10 validation additions

M10 must add profile-aware conformance for:

- Local `node:sqlite` + Drizzle versus PostgreSQL domain parity;
- Local single-node Restate versus the accepted M9 cloud Restate semantics;
- all-in-one Local composition from clean state;
- direct Local RuntimeTransport with no Runtime Gateway process;
- Self-hosted `simple` Compose with SQLite;
- Self-hosted `server` with PostgreSQL;
- user-controlled filesystem/S3-compatible storage;
- Local/Self-hosted SecretsProvider adapters;
- host-side HPKE remote-control contract;
- explicit export/import/migration;
- backup/restore, restart, upgrade/rollback, and small-VPS resource evidence;
- one conformance suite comparing M9 managed cloud, Local, Self-hosted `simple`, and Self-hosted `server` for deployment-independent semantics.

## M11 test architecture

M11 owns the final release validation layout. At minimum it must classify each suite as one primary lane:

Failure-injection tests use recording or deliberately failing adapters and assert durable state,
recovery, and idempotency rather than internal call order.

- unit;
- contract/schema;
- integration;
- end-to-end;
- smoke/configuration;
- security/adversarial;
- eval;
- performance/capacity;
- recovery/chaos;
- infrastructure/live-provider certification.

The aggregate release gate cannot pass when a required lane is skipped, cancelled, missing, or inconclusive. M11 must identify the exact deployment profile/configuration/version used by each production-shaped test.
Independent test groups run in parallel where their resources are isolated.

## Current PostgreSQL integration fixture

The repository currently starts a pinned local PostgreSQL service for integration testing. That remains useful for:

- Neon/PostgreSQL-compatible domain behavior;
- Self-hosted `server` behavior;
- migration/transaction/recovery testing.

It must not be described as the M10 Local product profile. M10.3 adds SQLite and cross-adapter conformance.

## Runtime acceptance

Existing M4–M6 suites remain useful for Runtime Fabric, Runtime Gateway, Managed Pi, and ACP behavior. Their release interpretation changes by topology:

- Runtime Gateway evidence applies to non-co-located RuntimeNodes.
- M10 must add `DirectLocalRuntimeTransport` evidence for co-located managed Pi/ACP execution.
- A runtime certification is tied to exact RuntimeAdapter + RuntimeDriver + RuntimeTransport + harness/protocol + deployment profile/location.

## Durable execution acceptance

Existing Temporal workflow tests remain historical execution-lifecycle evidence until M9.8. M9.8 must replace active release evidence with Restate equivalents while preserving accepted lifecycle semantics: retries, waits, deadlines, cancellation, interactions, restart recovery, idempotency, reconciliation, parent/child execution, and bounded LangGraph integration.

M10.1 then runs the same Restate workflow/conformance behavior in Local and Self-hosted compositions.

## Security and secret-canary testing

Secret canaries must cover:

- Railway build/deploy/configuration output;
- Neon connection/migration diagnostics;
- Restate state/logging;
- R2 metadata/errors;
- public API/SDK/events;
- runtime/gateway/direct transport;
- credential-vault use;
- SQLite/PostgreSQL persistence and backups;
- Local/Self-hosted exports;
- HPKE relay fixtures;
- telemetry and incident evidence.

Deployment bootstrap secrets and dynamic connector/provider credentials are separate secret classes and both require leak tests.

## Coverage goals

Unit coverage remains at or above the repository's configured 80% threshold unless an explicit accepted
change updates the policy. Add focused tests rather than lowering coverage to make a gate green.
The complete unit report is emitted as LCOV for CI coverage publication.

## Evidence rules

Every production-readiness result records exact commit, toolchain, deployment profile, persistence adapter/schema, Restate version, RuntimeAdapter/Driver/Transport, runtime/provider versions, relevant configuration digest, command, timestamp, environment, and outcome.

Mocked or sampled evidence must be labeled. It cannot replace required concrete evidence when the milestone acceptance explicitly requires Railway, Neon, R2, Restate, SQLite, Compose, or another real implementation.

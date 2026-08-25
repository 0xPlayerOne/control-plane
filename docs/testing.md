# Testing

The repository uses Bun's native test runner. Keep tests deterministic, isolate mutable state,
and prefer real implementations over mocks when the dependency is local and inexpensive.

## Commands

- `bun run test` builds once, then runs the unit, end-to-end, and smoke groups in parallel.
- `bun run test:unit` runs colocated package and application tests and enforces coverage.
- `bun run test:integration` starts the pinned local PostgreSQL service when needed, runs all
  integration projects serially to avoid cross-project migration contention, and stops only the
  database service that it started. The shared harness still creates two isolated databases in
  parallel to validate concurrent test workers. Integration files use a 30-second per-test budget for
  cold database creation and migration, and the runner allows PostgreSQL up to 60 seconds to
  checkpoint during shutdown. Before projects start, the runner waits for a successful SQL query
  instead of relying only on the container health transition.
- `bun run test:e2e` runs the M2-M5 cross-package acceptance scenarios.
- `bun run test:smoke` runs repository policy, infrastructure, and service-bootstrap checks.
- `bun run test:foundation` runs the complete unit and integration foundation suite from a clean
  checkout with one command.
- `bun run test:acceptance` is the one-command acceptance gate. It checks dependency ancestry,
  installs the frozen lockfile, runs formatting, lint and boundary enforcement, type-checking, builds,
  the full foundation and M2-M5 suites, Terraform validation, and all service plus migration
  container builds.
- `bun run test:coverage` enforces the unit coverage goal and writes `coverage/lcov.info` for Code
  Foundry's coverage upload step.
- `bun run compatibility:check` validates exact runtime certifications, evidence sources, and the
  generated matrix schema. The root `type-check` command includes this gate.
- `bun run test:m3-acceptance` runs the durable execution and recovery scenario matrix.
- `bun run test:m4-acceptance` runs the adapter-neutral Runtime Fabric scenario matrix used to
  qualify inventory, eligibility, routing, sessions, read models, and historical attempt references.
- `bun run test:m5-acceptance` runs the Runtime Gateway security, delivery, recovery, inventory, and
  protocol-version scenario matrix.
- `bun run test:shard -- --shard=1/2` forwards Bun's deterministic file sharding option to the unit
  group. CI shards must use distinct output directories if they collect coverage.

Code Foundry detects the four public group scripts (`test:unit`, `test:integration`, `test:e2e`, and
`test:smoke`) and schedules them as independent parallel jobs. The internal `test:group:*` scripts
avoid rebuilding when `bun run test` mirrors that fan-out locally.

## Coverage goals

Unit coverage must remain at or above 80% for both lines and functions. Bun excludes test files and
compiled `dist/` copies from the denominator, prints a text summary, and writes an LCOV report under
`coverage/`. `scripts/check-coverage.mjs` enforces the aggregate threshold from that LCOV file, while
`.github/code-foundry.yml` retains the same 80% policy for CI reporting. The threshold is checked after
Bun has produced the complete workspace report, so a low-level adapter cannot replace the intended
aggregate gate. Add focused tests instead of lowering the goal.
The root `tsconfig.json` preserves the Control API's legacy-decorator transform when Bun executes all
workspace tests in one process, so that application remains part of the aggregate coverage result.

## Suite ownership

- **Unit** tests stay beside the production module and avoid network, database, and filesystem I/O.
- **Integration** tests use `.integration.test.*` names and exercise HTTP, PostgreSQL, or another
  local boundary. Use `withTestApplication` and `withIsolatedPostgres` so cleanup runs on failure.
- **Contract** tests belong to the package that owns the stable public contract. Generated OpenAPI
  drift is checked separately through `bun run openapi:check`.
- **Failure-injection** tests use recording or deliberately failing port adapters and assert state,
  not internal call order.
- **End-to-end** tests cover the critical cross-package M2-M5 acceptance flows without external
  credentials.

Vendor adapters must expose stable ports and use fakes or recording adapters in ordinary CI. Unit
and integration tests must not require production credentials or a developer's persistent database.

## M1 foundation acceptance

From a full, clean clone with Git, Docker Buildx, Node 24.18.0, and Bun 1.3.14 available, run:

```sh
bun run test:acceptance
```

The command fails if any accepted M1.1-M1.8 commit is absent from history, the pinned toolchain files
drift, a forbidden import crosses a package boundary, a zero-state PostgreSQL migration or isolated
transaction fails, a service cannot boot and shut down through shared configuration, telemetry leaks
the credential sentinel, Terraform is invalid, or an ARM64 container cannot build. It creates and
removes its own PostgreSQL test service and needs no persistent local state or manual database repair.

CI runs the core suite, three environment-specific Terraform validations, and the shared container
build graph as parallel jobs. `Foundation Acceptance / Gate` aggregates them into one stable result.
Local iteration may use the runner's explicit skip flags, but completion requires the unskipped command.

## M2 core-domain acceptance

`tests/m2-core-domain.test.mjs` submits a versioned Agent HQ service intent through the public SDK,
authenticates the least-privilege service principal, resolves exact published profile and Skill
versions, compiles a revision-pinned ContextPackage, and persists a deterministic immutable
ExecutionPlan. The test retrieves the content-addressed references without a database or vendor
adapter and asserts that runtime dispatch remains at zero.

The same suite fails closed for invalid, expired, revoked, and cross-scope credentials; missing,
deprecated, revoked, or incompatible catalog versions; stale, unauthorized, and over-budget context;
contradictory runtime, model, policy, or tool requirements; persisted-plan mutation; and public SDK
contract-major drift. It deliberately does not execute Pi, ACP, LangGraph, LiteLLM, MCP, E2B, or
Temporal, so M3 durable-execution and M4 runtime work can start from the same pinned seam.

## M3 durable execution acceptance

Run `bun run test:m3-acceptance` to exercise authenticated execution acceptance, stable effect keys,
workflow restart, activity retry, duplicate and out-of-order progress, durable interactions,
cancellation races, Agent HQ outage replay, and explicit reconciliation of stale work. The suite uses
the mock runtime boundary and requires no production runtime or external credentials.

## M4 Runtime Fabric acceptance

Run `bun run test:m4-acceptance` to exercise multiple RuntimeConnections on one RuntimeNode,
managed-cloud and local candidates for the same plan, required and optional capability outcomes,
node-online/runtime-unhealthy separation, stale capability inventory, policy-constrained preferences,
stable tie-breaking, capability-specific external-session controls, safe Agent HQ read models, and a
routed attempt that survives later runtime disconnection.

The suite uses only the normalized Runtime Fabric and domain ports. It imports no concrete runtime
gateway, Pi SDK, or ACP implementation, so M6 adapters can reuse the harness as a conformance target.
Fixtures are deterministic and contain only opaque native identifiers; public projections are asserted
not to expose those identifiers or unrestricted native state.

## M5 Runtime Gateway acceptance

Run `bun run test:m5-acceptance` to execute the Runtime Gateway's provider-neutral protocol,
device-bound authentication, WebSocket lifecycle, durable command delivery, normalized event and
inventory ingestion, and reconnect reconciliation scenarios as one suite. It covers wrong-scope,
expired, replayed, and revoked credentials; lost acknowledgements and terminal outcomes; duplicate
delivery; command expiry; cancellation races; stale inventory; cross-instance replacement; malformed
and oversized frames; backpressure; and bounded restart recovery.

The suite records protocol versions 1.0 through 1.5 and runs inside Code Foundry's independent E2E
job. Component tests remain colocated with the Runtime Gateway so the acceptance entrypoint reuses the
same executable controls instead of maintaining divergent fixtures.

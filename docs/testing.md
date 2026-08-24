# Testing

The repository uses Bun's native test runner. Keep tests deterministic, isolate mutable state,
and prefer real implementations over mocks when the dependency is local and inexpensive.

## Commands

- `bun run test:unit` runs package and repository unit tests.
- `bun run test:integration` starts the pinned local PostgreSQL service when needed, runs all
  integration projects, and stops only the database service that it started.
- `bun run test:foundation` runs the complete unit and integration foundation suite from a clean
  checkout with one command.
- `bun run test:acceptance` is the one-command acceptance gate. It checks dependency ancestry,
  installs the frozen lockfile, runs formatting, lint and boundary enforcement, type-checking, builds,
  the full foundation and M2 core-domain suites, Terraform validation, and all service plus migration
  container builds.
- `bun run test:coverage` produces per-package Bun coverage reports without imposing a new
  threshold beyond the repository policy.
- `bun run test:m4-acceptance` runs the adapter-neutral Runtime Fabric scenario matrix used to
  qualify inventory, eligibility, routing, sessions, read models, and historical attempt references.
- `bun run test:shard -- --shard=1/2` forwards Bun's deterministic file sharding option to package
  tests. CI shards must use distinct PostgreSQL databases; the shared fixture does this by default.

## Suite ownership

- **Unit** tests stay beside the production module and avoid network, database, and filesystem I/O.
- **Integration** tests use `.integration.test.*` names and exercise HTTP, PostgreSQL, or another
  local boundary. Use `withTestApplication` and `withIsolatedPostgres` so cleanup runs on failure.
- **Contract** tests belong to the package that owns the stable public contract. Generated OpenAPI
  drift is checked separately through `bun run openapi:check`.
- **Failure-injection** tests use recording or deliberately failing port adapters and assert state,
  not internal call order.
- **End-to-end** tests are reserved for critical cross-service user flows and will be introduced
  when M2+ supplies those flows.

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
Temporal, so M3 runtime work and M4 durable-execution work can start from the same pinned seam.

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

# Testing

The repository uses Bun's native test runner. Keep tests deterministic, isolate mutable state,
and prefer real implementations over mocks when the dependency is local and inexpensive.

## Commands

- `bun run test:unit` runs package and repository unit tests.
- `bun run test:integration` starts the pinned local PostgreSQL service when needed, runs all
  integration projects, and stops only the database service that it started.
- `bun run test:foundation` runs the complete unit and integration foundation suite from a clean
  checkout with one command.
- `bun run test:coverage` produces per-package Bun coverage reports without imposing a new
  threshold beyond the repository policy.
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

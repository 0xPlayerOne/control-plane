# PostgreSQL persistence

PostgreSQL is the authoritative durable store for Control Plane domain state. The server-only
`@control-plane/database` package owns Drizzle schemas, migrations, live connections, serializable
transaction helpers, and isolated integration-test databases. Durable correctness must not depend on
Valkey or Redis.

## Local database

Start the pinned PostgreSQL service without deleting existing local data:

```sh
bun run db:up
```

The local service listens only on `127.0.0.1:54329`. Copy
`packages/database/.env.example` to `packages/database/.env.local`, then export those values for the
migration or integration command being run. The committed values are local-only and must never be
reused outside a developer machine.

Stop the service without deleting its volume:

```sh
bun run db:stop
```

The local roles are deliberately separate:

| Role                     | Environment variable     | Permitted purpose                                               |
| ------------------------ | ------------------------ | --------------------------------------------------------------- |
| `control_plane_app`      | `DATABASE_URL`           | Ordinary application queries and domain transactions            |
| `control_plane_migrator` | `DATABASE_MIGRATION_URL` | Schema migrations and grants on owned objects                   |
| `control_plane_admin`    | `DATABASE_ADMIN_URL`     | Local provisioning, backup/restore, and isolated test databases |

Production credentials must be injected by the deployment platform or secrets manager. Application
processes receive only `DATABASE_URL`; migration and administrative credentials belong in separate
one-shot jobs or operator sessions. URLs are loaded through `@control-plane/config` and are never
included in diagnostics.

## Schema and naming conventions

Schemas are grouped by domain boundary under `packages/database/src/schema`, not one file per table.
Tables and columns use plural `snake_case` names. Identifiers are database-generated UUIDs; timestamps
use `timestamp with time zone`; structured payloads use JSONB; revisions are bigint values beginning
at one; enums are native PostgreSQL enums; and soft deletion uses a nullable `deleted_at` timestamp.

The foundation migration creates inbox and outbox tables for atomic domain mutation and event
publication. `withDomainTransaction` uses a serializable, read-write transaction so domain records,
inbox acknowledgements, and outbox events can commit or roll back together.

## CommandInbox retention and replay

`command_inbox` deduplicates state-changing requests by service principal, operation, workspace,
project, and idempotency key. The first accepted record and its logical execution commit in one
transaction. Identical retries return the stored execution and current accepted, processing,
terminal, or reconciliation-required status. Reusing the key with another canonical payload hash
fails closed and increments durable conflict audit metadata; raw command payloads are not retained.

Every record has an explicit `retention_expires_at`. It must extend beyond the upstream outbox retry
and reconciliation window. Retries after that deadline fail closed rather than creating another
logical execution. Operators may purge expired records only after the upstream replay window has
also expired; an idempotency key must not be reused while either side can still replay it.

## ExecutionEvent log and outbox

`execution_events` is the authoritative append-only execution event log and publication outbox. Events
receive a unique per-execution sequence under a transaction-scoped lock, replay in sequence order,
and retain the same event ID across delivery retries. Required execution transitions and their events
commit in one transaction; a failed event insert rolls the state mutation back.

Payloads are normalized, redacted before persistence, and limited to 16 KiB. Raw harness, prompt,
model, tool, credential, and file payloads are prohibited. Publication attempts update delivery
metadata without creating another semantic event. Events remain replayable until their explicit
retention deadline and are hidden from ordinary replay only after archival.

## Migration workflow

Generate and review migrations from the database package:

```sh
cd packages/database
bun run db:generate
bun run db:check
```

Review every generated SQL statement, schema snapshot, lock impact, index strategy, and data rewrite.
Never edit an applied migration. Correct production mistakes with a new forward-fix migration. Apply
migrations from a dedicated job with `DATABASE_MIGRATION_URL`:

```sh
cd packages/database
bun run db:migrate
```

The migrator records applied files in Drizzle's migration journal, making repeated runs deterministic.
Ordinary application startup neither imports the migration entrypoint nor requires migration or admin
credentials.

## Integration databases

Integration tests generate names with the `control_plane_test_` prefix, create each database with the
administrative credential, migrate it from zero, grant DML-only access to the application role, and
dispose it after the suite. The lifecycle refuses reused role identities and never accepts a caller-
chosen database name.

```sh
cd packages/database
bun run test:integration
```

Only run integration tests against the local Compose service or a dedicated disposable PostgreSQL
instance. The lifecycle terminates connections and drops only the random database it created.

## Backup and restore

Before a risky migration, take a provider snapshot and a logical backup with an administrative backup
role. Encrypt backups, restrict access, record retention, and test restores regularly. Restore into a
new database first, run migrations and integrity checks there, then switch traffic through the normal
change process. Never validate restore procedures by overwriting the active production database.

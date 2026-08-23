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

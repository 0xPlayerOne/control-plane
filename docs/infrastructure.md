# Infrastructure and deployment baseline

The accepted first-party managed-cloud Control Plane target is **Railway compute + Neon PostgreSQL + Cloudflare R2 + Restate**. M9 owns making that profile real and production-shaped. M10 then ports the same Control Plane core and execution semantics to Local desktop and Self-hosted/VPS deployment profiles.

The repository still contains the earlier AWS/ECS/Terraform implementation from M1. Those files are historical/portable infrastructure assets until M9.7 explicitly replaces the first-party cloud path. They must not be cited as the current deployment target or as evidence that a cloud environment exists.

## Milestone ownership

- **M9.7 #215 — Railway service builds:** replace the AWS/ECS-first build/deploy baseline with reproducible Railway service configuration.
- **M9.8 #216 — Restate managed-cloud migration:** replace Temporal in the active Railway cloud path and define the Restate service/runtime topology.
- **M9.9 #217 — managed dependencies/configuration:** wire Neon, R2, service authentication, Railway private networking, secrets/configuration, health/readiness, and explicit database migration.
- **M9.10–M9.13 #210–#213 — canonical behavior:** freeze public contracts, Profile/Skill behavior, ContextProvider behavior, and operational defaults before portability work.
- **M9.6 #73 — cloud activation gate:** runs after the implementation/configuration work and closes only when live Railway staging is deployable and verified.
- **M10 — Local & Self-Hosted Portability:** substitutes persistence, storage, secrets, process supervision, topology, and runtime transport adapters while preserving the accepted M9 semantics.

## Managed-cloud provider map

| Capability | Accepted M9 provider/boundary | Rule |
| --- | --- | --- |
| Compute | Railway | Repository-owned service configuration; dashboard-only settings are not authoritative. |
| Relational state | Separate Control Plane Neon PostgreSQL | Drizzle migrations are explicit; Agent HQ uses a different Neon project/database. |
| Object storage | Cloudflare R2 through `ObjectStore` | R2 identifiers never enter public/domain contracts. |
| Durable workflows | Restate through `WorkflowRuntime` | Temporal is superseded for the release path; Restate-specific types stay out of public/domain contracts. |
| Service configuration/bootstrap secrets | Railway service/shared variables | Values are never committed; configuration is validated at startup. |
| Dynamic connector/provider credentials | Provider-neutral credential-vault/secret boundary | Railway environment variables are not a substitute for user-scoped dynamic credential storage. M9.9 must explicitly retain or replace the legacy AWS adapter behind the port and document the accepted cloud implementation. |
| Internal networking | Railway private networking where applicable | Only explicitly required authenticated endpoints receive public ingress. |
| Coordination/cache | Replaceable and only where measured need exists | Never authoritative for durable correctness. |

## Current external-resource state

As of the current M9 planning baseline:

- a Railway `control-plane` project exists with the five historical server/cloud service targets;
- their initial deployments have failed before runtime because the monorepo build path does not build/resolve internal workspace packages correctly;
- the Railway services do not yet have Control Plane application variables configured;
- a separate Neon project named `control-plane` exists, but the Control Plane Drizzle/domain schema has not yet been applied and no Railway service is currently wired to it;
- existing `neon_auth` tables in that Neon project are not Control Plane identity authority and must not become an application dependency;
- R2 and Restate must be provisioned/configured and verified through M9.8/M9.9 before M9.6 can close.

Configuration shape is not deployment evidence. M9.6 requires an actual successful staging deployment, migrations, health/readiness, representative durable execution, restart/recovery, rollback/forward repair, R2 operations, and measured operational evidence.

## Railway service composition

The historical server/cloud composition roots remain:

- `control-api`
- `workflow-worker`
- `runtime-worker`
- `runtime-gateway`
- `tool-gateway`

M9.8 may change the workflow-worker/service topology where the old shape exists only because of Temporal. Do not preserve a five-service topology merely for historical symmetry. Service boundaries are deployable composition roots, not public product contracts.

M9.7 should use a dependency-aware, reproducible container build from the monorepo. The existing `infrastructure/containers` build pipeline may be adapted for Railway. AWS/ECS-specific image platform assumptions, ECR publication requirements, task definitions, Terraform roots, IAM roles, CloudWatch/SNS wiring, and ECS rollout mechanics are no longer the first-party deployment contract.

## Neon PostgreSQL

The Control Plane cloud database is external to Railway and independently owned.

Requirements:

1. Use a dedicated Control Plane Neon project/database, separate from Agent HQ.
2. Apply repository-owned Drizzle migrations through an explicit migration job/pre-deploy step; ordinary service startup must not silently migrate production.
3. Maintain separate runtime and migration/admin authority. Only services that need relational persistence receive runtime access.
4. Validate schema compatibility before accepting traffic.
5. Exercise reconnect, forward repair, backup/PITR or equivalent recovery, and restore procedures in staging.
6. Keep provider/database identifiers out of public/domain contracts.
7. Treat any unrelated `neon_auth` schema as non-authoritative; leave inert or remove safely only through an explicit M9 decision.

The repository's local PostgreSQL Compose fixtures remain useful for integration tests and server-profile development. They are **not** the M10 product Local persistence profile, which uses embedded SQLite behind `PersistenceProvider`.

## Cloudflare R2

R2 is used only for Control Plane-managed cloud object storage and explicitly stored/promoted cloud artifacts/bundles. M9.9 must provision or verify the environment-specific bucket/configuration, least-privilege credentials, endpoint settings, lifecycle/retention rules, and adapter operations.

Local and Self-hosted profiles introduced in M10 use filesystem or user-controlled S3-compatible storage by default. Switching `ObjectStore` must not change Artifact identity or public contracts.

## Restate

Restate is the canonical durable workflow runtime across profiles.

- M9.8 owns the **Railway cloud** migration from Temporal to Restate, including networking, health, persistence, restart/redeploy, observability, and in-flight execution behavior.
- M10.1 owns packaging/porting the already accepted Restate workflow implementation to Local and Self-hosted profiles.

Do not make M10 responsible for getting cloud Restate working for the first time.

## Configuration and secrets

All service bootstrap configuration is typed and validated. Staging/production values are supplied by Railway configuration and approved external providers; secret values never belong in source, images, logs, issue bodies, or generated docs.

Separate **service/bootstrap secrets** from **dynamic user/provider credentials**. Railway variables are appropriate for deployment configuration such as database endpoints, service credentials, Restate configuration, R2 credentials, and master/bootstrap secret references. User-scoped connector/provider credentials require the audited credential-vault `SecretProvider` boundary and cannot be modeled as one environment variable per user credential.

M10 adds Local and Self-hosted `SecretsProvider` adapters without changing secret-reference/rotation/revocation semantics.

## Deployment, migration, and rollback

The accepted managed-cloud release flow is:

1. Build/test/scan reproducible service images from the complete workspace.
2. Validate repository-owned Railway service configuration and exact image/application revision.
3. Validate required Railway variables and external dependency configuration without exposing values.
4. Run the explicit Neon migration step with separately scoped migration authority.
5. Deploy the required service topology and Restate runtime.
6. Verify liveness/readiness through intended public/private paths.
7. Run a representative durable execution and R2 operations.
8. Exercise service/Restate/database reconnect and failed-deploy rollback/forward repair.
9. Run the M9 observability/security/recovery/load evidence against the real staging environment.
10. Record exact commit, configuration versions, migrations, service versions, resource/cost measurements, and rollback target.

A failed schema migration blocks application rollout. Applied production migrations are repaired forward unless an explicitly reviewed restore procedure is required.

## Local and Self-hosted profiles

M10 introduces:

- **Local:** all-in-one Control Plane, Node 24 `node:sqlite`/Drizzle, pinned single-node Restate, filesystem storage, direct RuntimeTransport, no Docker/PostgreSQL/Redis/Temporal/Runtime Gateway requirement for ordinary co-located execution.
- **Self-hosted `simple`:** containerized all-in-one, SQLite, Restate, filesystem storage, optional co-located runtimes/Cortana.
- **Self-hosted `server`:** PostgreSQL-backed server composition, Restate, filesystem or S3-compatible storage, split services/Runtime Gateway only where topology requires them.

The M9 Railway profile remains the semantic reference while M10 substitutes infrastructure adapters. M10 must keep the M9 cloud smoke/conformance baseline green throughout the extraction.

## Historical AWS infrastructure

The `infrastructure/terraform` AWS/ECS modules and associated AWS operational assumptions are retained as historical/provider-portability assets until M9.7 decides what to delete, archive, or preserve. They are not the current first-party cloud runbook, not a release prerequisite, and not evidence that AWS resources exist.

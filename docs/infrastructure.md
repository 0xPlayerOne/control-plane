# Infrastructure and deployment baseline

The accepted first-party **Cloud** Control Plane target is **Railway compute + Neon PostgreSQL + Cloudflare R2 + Restate**. M9 owns making that profile real and production-shaped. The product has exactly three deployment profiles: Cloud, Hosted, and Local. M10 then ports the same Control Plane core and execution semantics to Local desktop and Hosted/VPS deployment profiles.

M9 is rewriting the earlier AWS/ECS/Terraform implementation into the active Railway/Neon/R2 Cloud
profile. AWS is not a supported deployment option or compatibility layer; the Cloud, Hosted/VPS, and Local options share
application semantics while using different infrastructure adapters.

Each Railway service declares a dependency-aware Turborepo build filter (for example,
`bun run build --filter=@control-plane/workflow-worker...`). The trailing dependency closure is
required because Railway builds from a clean checkout and workspace package imports must be compiled
before the selected service.

## Milestone ownership

- **M9.7 #215 — Railway service builds:** replace the AWS/ECS-first build/deploy baseline with reproducible Railway service configuration.
- **M9.8 #216 — Restate managed-cloud migration:** replace Temporal in the active Railway cloud path and define the Restate service/runtime topology.
- **M9.9 #217 — managed dependencies/configuration:** wire Neon, the existing Control Plane R2 bucket, service authentication, Railway private networking, secrets/configuration, health/readiness, and explicit database migration.
- **M9.10–M9.13 #210–#213 — canonical behavior:** freeze public contracts, Profile/Skill behavior, ContextProvider behavior, and operational defaults before portability work.
- **M9.6 #73 — cloud activation gate:** runs after the implementation/configuration work and closes only when live Railway staging is deployable and verified.
- **M10 — Local & Hosted Portability:** substitutes persistence, storage, secrets, process supervision, topology, and runtime transport adapters while preserving the accepted M9 semantics.

## Managed-cloud provider map

| Capability                              | Accepted M9 provider/boundary                     | Rule                                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Compute                                 | Railway                                           | Repository-owned/reproducible service configuration; dashboard-only settings are not sufficient release evidence.                                                              |
| Relational state                        | Separate Control Plane Neon PostgreSQL            | Drizzle migrations are explicit; Agent HQ uses a different Neon project/database.                                                                                              |
| Object storage                          | Cloudflare R2 through `ObjectStore`               | Current Control Plane bucket is `ctrl-plane` with Wrangler binding `ctrl_plane`; physical identifiers remain deployment configuration and never enter public/domain contracts. |
| Durable workflows                       | Restate through `WorkflowRuntime`                 | Temporal is superseded for the release path; Restate-specific types stay out of public/domain contracts.                                                                       |
| Service configuration/bootstrap secrets | Railway service/shared variables                  | Values are never committed; configuration is validated at startup.                                                                                                             |
| Dynamic connector/provider credentials  | Provider-neutral credential-vault/secret boundary | Railway environment variables are not a substitute for user-scoped dynamic credential storage. M9.9 must document the active provider implementation behind the port.          |
| Internal networking                     | Railway private networking where applicable       | Only explicitly required authenticated endpoints receive public ingress.                                                                                                       |
| Coordination/cache                      | Replaceable and only where measured need exists   | Never authoritative for durable correctness.                                                                                                                                   |

## Current external-resource state

As of the current M9 activation baseline:

- a Railway `control-plane` project and isolated staging environment exist;
- dependency-aware monorepo builds are fixed and the active Cloud application topology is `control-api` plus `workflow-worker`;
- the private Restate runtime is separately pinned in `restate.json` and requires live provisioning;
- a dedicated Neon staging branch has the complete Control Plane schema and least-privilege runtime/migration roles; Neon main remains untouched;
- existing `neon_auth` tables in that Neon project are not Control Plane identity authority and must not become an application dependency;
- a Cloudflare R2 bucket named **`ctrl-plane`** already exists for the Control Plane managed-cloud ObjectStore, with logical Wrangler binding **`ctrl_plane`**;
- an authenticated Wrangler CLI is available to implementation agents for non-destructive R2 inspection/configuration and synthetic smoke tests;
- the R2 bucket still requires environment mapping, least-privilege service credentials, Railway configuration, lifecycle/retention policy, and adapter-level write/read/delete verification before M9.6 can close;
- Restate must be implemented/configured and verified through M9.8/M9.9 before M9.6 can close.

Configuration shape or resource existence is not deployment evidence. M9.6 requires an actual successful staging deployment, migrations, health/readiness, representative durable execution, restart/recovery, rollback/forward repair, R2 operations, and measured operational evidence.

## Railway service composition

The active Cloud application services are:

- `control-api` — public authenticated API plus health/readiness;
- `workflow-worker` — private Restate service endpoint.

The private `restate` server is a separately pinned infrastructure runtime, not a Control Plane
application build target.

`runtime-worker`, `runtime-gateway`, and `tool-gateway` remain source packages with their contracts
and tests intact, but are not always-on Railway services. The current runtime worker and tool gateway
have no persistent production loop, while Runtime Gateway requires a real remote-node identity and
coordination composition. They may be added to a future topology only when that topology has an
implemented use case and lifecycle; a placeholder process that marks ready and exits is not a cloud
service.

`workflow-worker` is the Restate HTTP endpoint for the `execution-lifecycle` workflow. Its endpoint contract is versioned in `infrastructure/railway/restate.json`; M9.9 owns the live Restate registration and dependency wiring.

The Railway staging Restate runtime is a private single node pinned to Restate 1.7.7 by immutable
multi-platform image digest. Railway must mount a persistent volume at `/restate-data` and preserve
the configured `control-plane-staging-1` node name across restarts. Restate ingress (8080), Admin API
(9070), and fabric (5122) remain private; only the Admin API `/health` route is used for service
health. This single-node shape is the M9 staging baseline, not a claim of high availability.

The per-service variable and credential-role contract is versioned in `infrastructure/railway/environment.json`. It contains names, classifications, and provider-neutral purposes only; secret values remain in Railway's secret boundary.

`.railway/railway.ts` is the executable Railway Infrastructure as Code definition. It owns the
project graph, sources, build/start commands, health checks, restart behavior, private endpoints,
and Restate volume attachment. Secret values remain provider-managed through `preserve()`; planning
must never use the CLI option that reveals variable values. The deprecated per-service
`railway.json`/`railway.toml` format is not used.

M9.7 should use a dependency-aware, reproducible container build from the monorepo. The existing `infrastructure/containers` build pipeline may be adapted for Railway. AWS/ECS-specific image platform assumptions, ECR publication requirements, task definitions, Terraform roots, IAM roles, CloudWatch/SNS wiring, and ECS rollout mechanics are no longer the first-party deployment contract.

## Neon PostgreSQL

The Control Plane cloud database is external to Railway and independently owned.

Requirements:

1. Use the existing dedicated Control Plane Neon project/database, separate from Agent HQ.
2. Apply repository-owned Drizzle migrations through an explicit migration job/pre-deploy step; ordinary service startup must not silently migrate production.
3. Maintain separate runtime and migration/admin authority. Only services that need relational persistence receive runtime access.
4. Validate schema compatibility before accepting traffic.
5. Exercise reconnect, forward repair, backup/PITR or equivalent recovery, and restore procedures in staging.
6. Keep provider/database identifiers out of public/domain contracts.
7. Treat any unrelated `neon_auth` schema as non-authoritative; leave inert or remove safely only through an explicit M9 decision.

The repository's local PostgreSQL Compose fixtures remain useful for integration tests and server-profile development. They are **not** the M10 product Local persistence profile, which uses embedded SQLite behind `PersistenceProvider`.

## Cloudflare R2

The existing **`ctrl-plane`** bucket is the current Control Plane-owned managed-cloud ObjectStore resource. Its Wrangler binding is **`ctrl_plane`**. Those names are operator/deployment configuration only; Control Plane public/domain contracts continue to use provider-neutral ObjectStore/Artifact references.

M9.9 must:

1. verify the bucket and account access using the authenticated Wrangler CLI;
2. decide/document staging-versus-production bucket isolation before production data exists;
3. configure least-privilege R2/S3-compatible credentials for only the Railway services that require object access;
4. configure endpoint/bucket/environment mapping through server-only deployment configuration;
5. define lifecycle/retention and CORS only where required;
6. perform synthetic Wrangler write/read/delete checks and then the same checks through the Control Plane `ObjectStore` adapter from Railway staging;
7. record a sanitized resource/configuration manifest without account tokens, access-key secrets, or raw credentials.

**Product storage ownership remains separate.** Agent HQ may use the same Cloudflare account/provider, but it uses a separate Agent HQ-owned bucket or environment-isolated bucket set and separate credentials. Agent HQ must not reuse the Control Plane `ctrl-plane` bucket or its broad credentials as Artifact authority.

Local and Hosted profiles introduced in M10 use filesystem or user-controlled S3-compatible storage by default. Switching `ObjectStore` must not change Artifact identity or public contracts.

## Restate

Restate is the canonical durable workflow runtime across profiles.

- M9.8 owns the **Railway cloud** migration from Temporal to Restate, including networking, health, persistence, restart/redeploy, observability, and in-flight execution behavior.
- M10.1 owns packaging/porting the already accepted Restate workflow implementation to Local and Hosted profiles.

Do not make M10 responsible for getting cloud Restate working for the first time.

## Configuration and secrets

All service bootstrap configuration is typed and validated. Staging/production values are supplied by Railway configuration and approved external providers; secret values never belong in source, images, logs, issue bodies, or generated docs.

Separate **service/bootstrap secrets** from **dynamic user/provider credentials**. Railway variables are appropriate for deployment configuration such as database endpoints, service credentials, Restate configuration, R2 credentials, and the encryption-key reference used by the vault. User-scoped connector/provider credentials are encrypted by `NeonEncryptedSecretProvider` and persisted through `PostgresEncryptedSecretStore`; they cannot be modeled as one environment variable per user credential.

M10 adds Local and Hosted `SecretsProvider` adapters without changing secret-reference/rotation/revocation semantics.

## Deployment, migration, and rollback

The accepted managed-cloud release flow is:

1. Build/test/scan reproducible service images from the complete workspace.
2. Validate repository-owned/reproducible Railway service configuration and exact image/application revision.
3. Validate required Railway variables and external dependency configuration without exposing values.
4. Run the explicit Neon migration step with separately scoped migration authority.
5. Deploy the required service topology and Restate runtime.
6. Verify liveness/readiness through intended public/private paths.
7. Run a representative durable execution and R2 ObjectStore operations.
8. Exercise service/Restate/database reconnect and failed-deploy rollback/forward repair.
9. Run the M9 observability/security/recovery/load evidence against the real staging environment.
10. Record exact commit, configuration versions, migrations, service versions, R2/Neon resource-purpose mapping, resource/cost measurements, and rollback target without credentials.

A failed schema migration blocks application rollout. Applied production migrations are repaired forward unless an explicitly reviewed restore procedure is required.

## Local and Hosted profiles

M10 introduces:

- **Local:** all-in-one Control Plane, Node 24 `node:sqlite`/Drizzle, pinned single-node Restate, filesystem storage, direct RuntimeTransport, no Docker/PostgreSQL/Redis/Temporal/Runtime Gateway requirement for ordinary co-located execution.
- **Hosted `simple`:** containerized all-in-one, SQLite, Restate, filesystem storage, optional co-located runtimes/Cortana.
- **Hosted `server`:** PostgreSQL-backed server composition, Restate, filesystem or S3-compatible storage, split services/Runtime Gateway only where topology requires them.

The M9 Railway profile remains the semantic reference while M10 substitutes infrastructure adapters. M10 must keep the M9 cloud smoke/conformance baseline green throughout the extraction.

## Former AWS infrastructure

The former `infrastructure/terraform` AWS/ECS modules and associated AWS operational assumptions are
not part of the active repository deployment path. Any remaining references in ADRs, changelogs, or
historical notes document the superseded design only; they are not a supported deployment,
compatibility layer, release prerequisite, or portability target.

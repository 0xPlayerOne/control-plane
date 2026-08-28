# Service configuration and bootstrap

All deployable services enter through `@control-plane/bootstrap`, which loads typed configuration from `@control-plane/config`, installs shutdown/fatal-error handling, and exposes health/readiness state. Configuration is deployment-profile aware; request data is never allowed to choose infrastructure or environment settings.

## Environments and profiles

`APP_ENV` accepts exactly `development`, `test`, `staging`, or `production`.

Deployment profile is a separate concept from application environment:

- managed cloud — Railway services using Neon, R2 and Restate;
- Local — all-in-one composition using SQLite, local Restate and direct RuntimeTransport;
- Self-hosted `simple` — containerized all-in-one with SQLite;
- Self-hosted `server` — PostgreSQL-backed server composition.

The same public/domain behavior must not depend on an environment-specific variable name.

Development and test may load local dotenv files. Staging and production do not load dotenv files automatically; configuration comes from the deployment/runtime secret/configuration boundary.

## Managed-cloud configuration — M9

Railway service/shared variables are the accepted initial source for **service/bootstrap configuration** such as:

- service version/commit/environment;
- service-to-service endpoints/credentials;
- Neon runtime connection reference;
- separately scoped Neon migration/admin reference for the migration job only;
- Restate endpoint/runtime configuration;
- R2 endpoint/bucket/credential references;
- bootstrap/master references for other deployment services.

M9.7/M9.9 must define the exact variable manifest per service, validation rules, public/private networking, `PORT` behavior, health/readiness, restart/drain behavior, and which services actually require each dependency.

Railway's injected `PORT` must be honored by HTTP services or mapped explicitly through repository-owned Railway configuration. Do not assume the historical fixed development ports are the cloud ingress contract.

## Dynamic credentials are separate

Railway environment variables are not the storage model for arbitrary user-scoped connector/provider credentials. Those remain behind the audited credential-vault secret-provider boundary. Service/bootstrap secrets and dynamic user/provider credentials are separate classes with separate lifecycle and least-privilege rules.

The repository currently contains an AWS Secrets Manager implementation from the earlier AWS-first architecture. M9.9 must explicitly select and verify the accepted managed-cloud dynamic credential-vault provider behind the stable interface, or explicitly justify retaining an external AWS Secrets Manager dependency. Until that decision is implemented and tested, documentation must not imply Railway variables replace the dynamic credential vault.

## Local and Self-hosted configuration — M10

Local and Self-hosted compositions consume the same typed configuration model through different adapters:

- packaged Local: host-secure handles for reusable secrets plus local data/component paths selected by the trusted launcher;
- standalone Local: owner-controlled environment/private-file references where supported;
- Self-hosted: environment/Docker/private-file or external secret-manager references;
- cloud-only provider identifiers such as Railway/Neon/R2 cannot be required by Local/Self-hosted core startup.

Profile-specific configuration may select persistence, object store, secrets, runtime transport, process supervision and service discovery. It may not redefine Task/Execution/Profile/Skill/ProjectState/ContextProvider semantics.

## Current service surfaces

The historical server/cloud composition currently includes:

| Service           | Development/default surface                                                   |
| ----------------- | ----------------------------------------------------------------------------- |
| `control-api`     | current development HTTP port contract                                        |
| `runtime-gateway` | current development gateway port contract                                     |
| `tool-gateway`    | current development tool port contract                                        |
| `workflow-worker` | current worker concurrency contract; M9.8 may change Temporal-shaped topology |
| `runtime-worker`  | current server/cloud runtime worker contract                                  |

M9.7/M9.8 may alter cloud process topology where an existing process exists only because of AWS/Temporal assumptions. M10 Local is not required to run these five applications as separate processes.

## Validation and diagnostics

- Missing/invalid startup configuration reports names and safe classifications, never values.
- Effective non-secret configuration/profile/version information is exposed for readiness/diagnostics.
- Sensitive keys/values are redacted before serialization.
- Optional providers do not become startup dependencies unless the selected immutable policy explicitly requires them.
- Schema/config incompatibility prevents readiness rather than allowing a partially configured revision to serve traffic.

## Shutdown

`SIGINT`/`SIGTERM` mark the process unready and close registered resources in reverse order. M9.13 owns the accepted graceful drain/cleanup defaults. Local launchers and Self-hosted supervisors must implement equivalent semantics without changing domain behavior.

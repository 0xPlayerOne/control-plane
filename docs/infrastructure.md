# Infrastructure and deployment baseline

This repository defines a production-shaped AWS/ECS baseline without claiming that an environment
has been provisioned. Terraform owns cloud topology and service interfaces; Buildx Bake owns the
reproducible container build. There is no Kubernetes layer.

## Scope and authority

| Capability                                                        | Classification                     | Contract                                                                                                 |
| ----------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| VPC, private service subnets, managed egress, and security groups | Authoritative                      | Terraform module `aws-platform`; one isolated VPC per environment                                        |
| PostgreSQL                                                        | Authoritative durable state        | Encrypted RDS, private access, backups, deletion controls, and an AWS-managed master secret              |
| Object storage                                                    | Authoritative durable state        | Private, versioned, KMS-encrypted S3 bucket; application data is not disposable                          |
| Service secrets and KMS                                           | Authoritative interface            | Terraform creates KMS keys and empty Secrets Manager shells; operators populate values outside Terraform |
| ECS task definitions, services, logs, and ECR repositories        | Authoritative deployment interface | Five long-running targets plus a one-off migration task; images must use immutable digests               |
| Cache                                                             | Replaceable                        | Encrypted Valkey/ElastiCache; never treat cached data as authoritative                                   |
| ECS tasks                                                         | Replaceable                        | Circuit-breaker rollbacks replace unhealthy revisions; tasks hold no durable local state                 |
| Temporal, LiteLLM, and E2B                                        | Deferred                           | Stable application ports remain the boundary; no vendor-specific resources are provisioned in M1         |
| Autoscaling and operational alarms                                | Authoritative deployment interface | Bounded per-service ECS scaling plus encrypted SNS alarm delivery                                        |
| Public load balancing, DNS, and vendor adapters                   | Deferred                           | Add only when the corresponding gateway or worker has a real lifecycle and measured requirement          |

Worker and gateway targets default to zero replicas. `control-api` is the only enabled target;
networking remains private until an authenticated ingress design is approved. A disabled target
still has an immutable task definition, least-privilege role, alarm, and bounded scaling path, but
must not be enabled until its dependency adapter and readiness contract pass staging.

## Reproducible containers

`infrastructure/containers/Dockerfile` pins Bun by both version and multi-platform image digest,
installs the frozen lockfile, builds the complete workspace, and runs as UID 1000. Bake fixes the
runtime platform to `linux/arm64`, matching the ECS task definition. No build argument or image
environment variable carries a secret.

```sh
bun run containers:print
docker buildx bake -f infrastructure/containers/docker-bake.hcl --load
docker buildx bake -f infrastructure/containers/docker-bake.hcl database-migrate --load
```

The default bake group builds `control-api`, `workflow-worker`, `runtime-worker`,
`runtime-gateway`, and `tool-gateway`. The separate `database-migrate` target has a migration-only
entrypoint. Publish images to the Terraform-created ECR repositories and deploy the registry
references returned by the registry with `@sha256:...`; mutable tags are rejected by Terraform.

## Environment and state separation

Development, staging, and production are independent Terraform roots under
`infrastructure/terraform/environments/`. Each root has distinct configuration, VPC CIDRs, remote
state key, lock file, capacity settings, and example variables. The S3 backend uses native state
locking. The backend bucket and IAM bootstrap are intentionally account-level prerequisites and
must not share application state.

```sh
cp infrastructure/terraform/environments/development/terraform.tfvars.example \
  infrastructure/terraform/environments/development/terraform.tfvars
terraform -chdir=infrastructure/terraform/environments/development init \
  -backend-config=bucket=CONTROL_PLANE_TERRAFORM_STATE \
  -backend-config=region=us-east-1
terraform -chdir=infrastructure/terraform/environments/development plan
```

Never commit the copied tfvars file or backend credentials. Repeat the process with the staging or
production root; never select an environment through a shared workspace. Run the credential-free
structural checks locally with `bun run infra:fmt:check` and `bun run infra:validate`.

## Secrets and service identity

Terraform creates one least-privilege task role and execution role per target. Tasks can read only
their declared secret shells; object-store actions and database/cache network identities are
granted per service. RDS creates and rotates
its master secret itself. Application database URLs, migration credentials, and service credentials
must be populated outside Terraform through an approved secret-delivery process; no secret value or
Secrets Manager secret version belongs in source, tfvars, Terraform state, or an image.

For secret rotation, write a new secret value, start a canary task definition revision, confirm its
health and dependency access, then force a rolling ECS deployment. Revoke the old credential only
after all old tasks have drained. Database rotation must preserve a dedicated, separately scoped
`DATABASE_MIGRATION_URL`; replicas receive `DATABASE_URL` and never migration authority.

## Migration, rollout, and rollback

Use this order for every deployment:

1. Build, test, scan, and publish all required images; record immutable image digests.
2. Run `terraform plan` in exactly one environment root and review state, capacity, and task changes.
3. Confirm the operations SNS topic has a tested incident subscription. Apply infrastructure and
   task-definition changes without increasing service replica counts.
4. Run `database-migrate` once as an explicit ECS task using the root outputs for cluster, private
   subnets, security group, and migration task definition. Wait for exit code zero. A migration is
   never a service replica startup hook.
5. Use the deployment compatibility gate to reject unsupported contracts, unverified migrations,
   mutable images, or a failed canary. ECS preserves full production capacity during rollout, and
   deployment circuit breakers automatically roll back tasks that cannot stabilize.
6. Confirm health, readiness, logs, migration version, and dependency access before completing the
   rollout.

If migration fails, do not deploy new replicas. Inspect the isolated task logs, repair with a new
forward migration, and rerun the operation. Do not edit an applied migration or automatically roll
back a schema that may already contain production data. For an application rollback, restore the
previous digest-pinned task definition and desired counts, then verify health. Restore PostgreSQL or
versioned object data only through a separately reviewed recovery operation.

## Health and operational signals

`control-api` exposes `/health` for process liveness and `/ready` for readiness. Its ECS container
health check uses the local `/health` endpoint; deployment verification must check both endpoints
through the intended network path. Workers and gateways remain deferred at zero replicas until they
define meaningful liveness, readiness, draining, and retry behavior. CloudWatch logs are encrypted
and retained longer in production, ECS container insights is enabled, and RDS, Valkey, and ECS CPU
alarms route through the operations SNS topic. Production RDS is Multi-AZ and deletion-protected
with a 35-day point-in-time recovery window. The incident, provider, policy, budget, backlog,
restore, canary, and access procedures are in `docs/operations.md`.

Terraform validation proves configuration shape, not cloud readiness. An actual environment still
requires reviewed backend bootstrap, credentials, a plan, an apply, migration execution, service
health evidence, and rollback rehearsal.

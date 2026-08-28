# Production operations runbook

This runbook covers the accepted Control Plane deployment sequence and must distinguish **managed cloud (M9)** from **Local/Hosted portability (M10)**. A release is not complete because infrastructure files exist; live environment evidence is required.

## Milestone sequence

- **M9 — Managed Cloud Deployment, Hardening & Evals:** make the Railway + Neon + R2 + Restate profile actually deploy, recover, and pass the cloud hardening/eval gates.
- **M10 — Local & Hosted Portability:** port the accepted M9 semantics to Local and user-controlled Hosted profiles.
- **M11 — Feature Completion & Production Audit:** rerun production-readiness evidence across managed cloud, Local, and Hosted.
- **M12 — Cross-Product Integration & Release:** connect the independently approved Control Plane candidate to Agent HQ and optional Cortana release candidates.

Historical AWS/ECS/Terraform procedures are not the current first-party cloud runbook.

## Managed-cloud access and configuration

The initial managed-cloud profile uses:

- Railway for compute/service lifecycle;
- a separate Control Plane Neon PostgreSQL project/database;
- Cloudflare R2 behind the `ObjectStore` boundary;
- Restate as the canonical durable workflow runtime;
- Railway private networking where applicable;
- Railway variables for service/bootstrap configuration;
- a separate provider-neutral credential-vault boundary for dynamic user/provider secrets.

Keep runtime database credentials separate from migration/admin authority. Keep service credentials scoped by service/audience. Do not store production credentials in repository files, issue bodies, test fixtures, or ordinary logs.

## Current M9 state

The Railway project has isolated `staging` and `production` environments. The active Cloud staging
topology is the public `control-api`, private `workflow-worker`, and separately pinned `restate`
runtime with its persistent Railway volume. Railway `staging` tracks Git `staging` and Neon staging,
while Railway `production` tracks Git `main` and Neon production; each environment has separate
least-privilege roles. The 2026-08-28 staging activation, restart, execution, Neon, R2, security,
resource, and bounded cost results are recorded in
[`evidence/m9-cloud-certification-2026-08-28.md`](evidence/m9-cloud-certification-2026-08-28.md).

The repository Cloud composition now persists accepted commands/executions in PostgreSQL and wires
the workflow worker's lifecycle activities to the same authoritative execution and plan data.
Staging uses the explicit `certification` runtime mode to persist and integrity-check a deterministic
terminal result through R2. Production uses `disabled` and cannot accept certification executions.
This path certifies the Control Plane cloud infrastructure only; later Agent HQ managed-runtime
support requires its own runtime provider and certification.

Do not treat the staging certification, current Railway dashboard, or existing AWS Terraform as
production certification. Production promotion remains a separate reviewed release gate.

## Managed-cloud release and rollback

The current operational target is RPO is 5 minutes and RTO is 60 minutes; M9.6 must replace these
planning values with measured Railway/Neon/R2/Restate staging evidence or an explicitly accepted
revision.

1. Require M9.7–M9.13 implementation/configuration gates to be complete.
2. Build/test/scan the complete monorepo using the repository-owned Railway/container build path.
3. Record exact commit, service versions, Restate version, schema/contracts, and repository-owned Railway configuration.
4. Validate required Railway variables and external dependency references without exposing secret values.
5. Run explicit Neon migrations using separately scoped migration authority.
6. Deploy required Railway services and the accepted Restate topology.
7. Verify liveness/readiness through intended public/private network paths.
8. Run a representative durable execution through Restate and verify authoritative Neon state plus R2 operations where used.
9. Exercise failed deploy rollback/forward repair, service restart/redeploy, Neon reconnect, Restate restart/recovery, and Runtime Gateway reconnect where applicable.
10. Run the existing M9 security, recovery, and performance tooling against the actual staging candidate and record measured evidence.

A database migration failure blocks rollout. Never hide a broken revision behind a green process health check. Applied schema changes are repaired forward unless a reviewed restore operation is explicitly required.

For M9 staging certification, verify the retained `m9/certification/` result with `get` and `head`,
match its digest to the terminal execution/command state, and replay the same accepted command to
confirm that no second logical artifact is created. Do not report this as managed Pi certification.

Run the repository-owned live certification harness only against the isolated Railway/Neon/R2
staging profile:

```sh
bun run certify:m9-cloud
```

The operator supplies `M9_CONTROL_API_URL`, `M9_SERVICE_AUTH_ISSUER`,
`M9_SERVICE_AUTH_KEY_ID`, `M9_SERVICE_AUTH_PRIVATE_KEY_FILE`, `DATABASE_URL`, `R2_ENDPOINT`,
`R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` through the local secret boundary. The
private signing key is a short-lived staging-certification credential whose matching public key is
configured in the staging Control API trust set; it is never committed or printed. `DATABASE_URL`
uses the least-privilege staging application role because the harness seeds one immutable bounded
certification plan through the same repository used by the service. The harness does not accept a
migration/admin connection.

A passing JSON record proves all of the following for one run: authenticated public acceptance,
terminal command/execution/attempt state in Neon, an integrity-matched retained result through the
R2 `ObjectStore`, and idempotent replay returning the original execution and artifact. The record
contains identifiers, timestamps, state, and digests only. Keep deployment IDs, exact source commit,
Railway build/readiness results, Restate registration/restart evidence, resource metrics, and the
sanitized harness record together in the M9.6 evidence attachment. The harness is not by itself
proof of rollback, restart recovery, load, isolation, secret-canary, or cost acceptance.

## Neon operations

- Use the dedicated Control Plane Neon project/database, never Agent HQ's database.
- Application services receive least-privilege runtime authority only where needed.
- Migration/admin authority is one-shot/operator scoped and not available to ordinary service replicas.
- Validate schema version before accepting traffic.
- On database saturation, stop nonessential producers and inspect query/pool/backlog evidence before increasing retry pressure.
- On corruption or accidental deletion, freeze writes where practical, restore into an isolated destination using Neon recovery/PITR or equivalent provider capability, verify schema/integrity/reconciliation, then switch through an explicit change process.
- The existing `neon_auth` schema in the Control Plane Neon project is not application identity authority and must remain unused unless an explicit architecture decision changes ownership.

## R2 operations

- R2 buckets remain private and are accessed only through the provider-neutral ObjectStore/Artifact boundary.
- Bucket/environment separation, retention/lifecycle, least-privilege credentials, and upload/download policy are defined in M9.9.
- Failed or ambiguous object operations reconcile against authoritative metadata/digests rather than assuming success.
- Local/Hosted data is not automatically promoted to R2; cloud storage requires an explicit authorized operation.

## Restate operations

- Restate is the only required durable workflow runtime for the accepted release path.
- Railway staging runs the immutable Restate image recorded in `infrastructure/railway/restate.json`,
  with a persistent `/restate-data` volume and stable node name. Never replace it with a floating
  image tag or an ephemeral filesystem deployment.
- Keep ingress, Admin API, and fabric ports private. Register `workflow-worker` through its Railway
  private-network endpoint and verify that the registration survives a Restate service restart.
- M9.8 replaces active Temporal cloud configuration with Restate and defines its Railway networking, persistence, health/readiness, restart, upgrade, and observability behavior.
- On Restate degradation, stop unsafe new admission where required, preserve durable command/domain state, and recover using the accepted Restate lifecycle guarantees.
- LangGraph graph/checkpoint mechanics remain subordinate to the Restate lifecycle; ProjectState remains separately authoritative.
- Temporal-specific worker/runbook evidence is historical migration provenance and is not part of the active path.

## Gateway and provider degradation

- Distinguish transport failure, provider refusal, policy denial, approval wait, budget exhaustion, and persistence/workflow failure in telemetry.
- Runtime Gateway is used only for non-co-located RuntimeNodes. Local co-located execution uses direct RuntimeTransport and must not fall back to Runtime Gateway as an implicit recovery path.
- On gateway disconnect, replay only durably identified commands and reconcile ambiguous outcomes before retry.
- On model/tool/sandbox/ContextProvider degradation, follow the pinned policy and approved fallback behavior; optional providers must not become undeclared startup dependencies.

## Local operations — M10

Local uses all-in-one Control Plane + SQLite + single-node Restate + filesystem storage + direct RuntimeTransport.

Operational requirements include:

- clean startup/shutdown and component health manifest;
- Control Plane/Restate crash recovery;
- host restart and sleep/wake behavior;
- SQLite backup/restore and corruption handling;
- local filesystem Artifact lifecycle;
- OS-secure secret handles or approved standalone-local secret references;
- no Docker/PostgreSQL/Redis/Temporal/Runtime Gateway requirement for ordinary Local execution;
- explicit unavailable/queued behavior when the selected node is offline, with no silent cloud failover.

## Hosted operations — M10

Hosted `simple` uses SQLite; `server` uses PostgreSQL. Both use Restate and user-controlled storage/secrets.

Required operational evidence includes:

- one documented Compose deployment path;
- persistent volumes across container/host restart;
- TLS/reverse-proxy and authenticated external API/relay configuration;
- backup/restore;
- update/rollback/forward repair;
- key/credential rotation/revocation;
- resource budgets for small VPS and server profiles;
- no dependency on Railway/Neon/R2/Agent HQ Cloud for standalone operation.

## Diagnostic correlation

Investigations begin with stable product/execution identifiers, not provider-specific resource IDs. Minimum useful correlation includes request, workspace, execution, attempt, workflow/Restate invocation, runtime/node/transport, profile/Skill versions, provider/tool/model policy versions, and trace identifiers.

Provider-specific Railway/Neon/R2/Restate identifiers may appear in operational diagnostics but do not replace stable Control Plane IDs and must not leak secrets or protected content.

## Security incidents

- Policy denial is authoritative and cannot be overridden by prompt/model/tool/provider content.
- On credential leakage, revoke/rotate first, then clean history/logs and record sanitized evidence.
- On suspected cross-workspace access, disable affected routes/credentials, preserve sanitized correlation evidence, run the isolation matrix, and block promotion until fixed.
- Remote relay/gateway incidents must preserve HPKE/content-redaction guarantees; cloud/relay systems must not require plaintext sensitive execution content.

## Scheduled evidence

- **Every managed-cloud candidate:** build/deploy, Neon migration/schema, Restate, R2, health/readiness, recovery, security, and cost evidence.
- **Every M10 candidate:** Local and Hosted clean install/start/restart/backup/restore/conformance evidence.
- **M11:** independent full-profile audit from frozen candidate.
- **M12:** live cross-product integration evidence only after M11 approval.

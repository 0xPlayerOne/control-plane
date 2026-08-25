# Production operations runbook

This runbook covers the M9 production deployment boundary. Terraform and tests define the
desired controls; a release is not complete until environment-specific evidence is attached to
the immutable evaluation and deployment records.

## Access and escalation

- Use short-lived federated AWS roles with separate read-only, deploy, database-migration, and
  break-glass recovery permissions. Do not use long-lived access keys or share roles.
- Subscribe the incident system to the Terraform output `operations_alarm_topic_arn` and test
  delivery before enabling replicas. An alarm with no confirmed subscription is not operational.
- ECS Exec is disabled. Diagnose through encrypted logs, traces, metrics, and approved one-off
  tasks. Break-glass access requires an incident record and post-incident credential rotation.
- Populate Secrets Manager values outside Terraform. Rotate with an overlapping credential,
  canary it, drain the old task revision, revoke the old credential, and retain the audit record.

## Release and rollback

1. Require the M9 security, evaluation, recovery, load, Terraform, container, and compatibility
   gates. Record exact commit, configuration, migration, and image digests. Promotion and rollback
   must use the PostgreSQL-backed release-audit repository; an unavailable audit store blocks the
   state change.
2. Review `terraform plan` for one environment. Reject mutable images, unexpected deletes,
   widened IAM/network rules, reduced alarms, or weakened backup settings.
3. Confirm a recent PostgreSQL recovery point and successful restore drill. Apply infrastructure
   without increasing disabled service counts.
4. Run the digest-pinned `database-migrate` task with both the service and database-client
   security groups. Stop if it exits nonzero or the expected migration version is absent.
5. Deploy one candidate task. The compatibility gate must accept its API, database, and gateway
   contracts. Verify readiness, error rate, p95 latency, provider access, and durable-write replay.
6. Increase to the normal replica count. ECS preserves 100% production capacity, permits at most
   200% during rollout, and automatically rolls back a deployment that cannot stabilize.
7. If the canary violates a budget, restore the previous digest-pinned task definition. Never
   reverse an applied schema migration in place; use a reviewed forward repair or PITR restore.

Targets with zero desired count are deliberately disabled until their real dependency adapter,
health/readiness contract, and alarms pass this procedure in staging. Do not turn a target on only
because its image builds.

## Database and object storage

- Production RDS is encrypted, private, Multi-AZ, deletion-protected, and retains 35 days of
  automated backups for point-in-time recovery. CPU and free-storage alarms page through the
  operations topic.
- On database saturation, stop nonessential producers, preserve the command/event backlog, inspect
  slow queries and connection counts, and scale only after identifying the constraint. Do not add
  blind retries; they amplify an outage.
- For corruption or accidental deletion, freeze writes, select a recovery time before the event,
  restore into a new instance, run integrity/reconciliation checks, and switch only after approval.
  RPO is 15 minutes and RTO is 60 minutes; record actual timings.
- The S3 object store is private, KMS-encrypted, and versioned. Incomplete uploads expire after seven
  days and noncurrent versions after 90 days. Restore a prior version rather than overwriting
  evidence. Tasks receive only their declared object actions.

## Gateway and provider degradation

- Distinguish transport failure, provider refusal, policy denial, approval wait, and budget
  exhaustion in telemetry. Never convert one class into another or expose credential material.
- On gateway disconnect, stop issuing new side effects, replay only durably identified commands,
  and reconcile ambiguous outcomes before retry. A command identity conflict fails closed.
- On model, tool, sandbox, Temporal, or other provider degradation, trip bounded admission, honor
  retry guidance, and use only a pre-approved compatible provider/routing policy. Disable the route
  if idempotency or usage settlement cannot be proven.
- Runtime Gateway remains disabled in production until a concrete authenticated WebSocket server
  adapter is injected and its lifecycle passes the staging canary. The application intentionally
  refuses a placeholder production startup.

## Diagnostic views and correlation queries

Start every investigation with the stable identifiers in the execution trace, then narrow by the
failure-class signals below. The machine-readable source of truth is `diagnosticQueries` in
`@control-plane/telemetry`; dashboards and alert links must preserve these fields rather than
embedding provider-specific identifiers.

| Failure class | Signals                                                                                             | Required correlation                                     |
| ------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Application   | `control.api.error.count`, `control.api.request.duration`, `service.name=control-api`               | `control.correlation_id`, `workspace.id`, `execution.id` |
| Workflow      | `workflow.backlog.count`, `workflow.replay.count`, `span.name=workflow.run`                         | `workflow.id`, `execution.id`, `execution.attempt.id`    |
| Gateway       | `runtime.gateway.connection.count`, `runtime.gateway.ack.duration`, `service.name=runtime-gateway`  | `runtime.node.id`, `runtime.id`, `execution.id`          |
| Runtime       | `runtime.available.count`, `span.name=runtime.route`, `span.name=runtime.start`                     | `runtime.id`, `runtime.node.id`, `execution.id`          |
| Provider      | `model.call.error.count`, `tool.call.error.count`, `span.name=model.call OR span.name=tool.execute` | `gen_ai.request.model`, `tool.id`, `execution.id`        |
| Policy        | `span.name=tool.authorize`, `event=policy.denied`, `event=approval.waiting`                         | `policy.version`, `tool.id`, `execution.id`              |

Join only on sanitized correlation attributes. If a trace is missing, query the authoritative
execution/event records by `execution.id`; telemetry gaps never authorize guessing state or
replaying a side effect.

## Policy, budget, and security incidents

- Policy denial is authoritative. Do not override it through prompt content, child-plan changes,
  tool arguments, or operator retries. Child work may narrow but never widen parent authority.
- On budget exhaustion, stop admission and settle already durable usage. Reconcile reservations
  before raising a limit; preserve the original policy version and decision evidence.
- For suspected cross-workspace access or credential leakage, disable the credential/route, retain
  sanitized correlation IDs, run the isolation matrix and secret-canary audit, rotate affected
  credentials, and notify the security owner. Never paste raw payloads or secrets into tickets.

## Event backlog and reconciliation

- Watch delivery latency, dead letters, command attempts, reconciliation lag, and usage-settlement
  lag. Autoscaling targets 65% ECS CPU and is bounded to three times steady configured capacity.
- During backlog growth, prefer bounded horizontal scale and provider-aware admission control.
  Preserve ordering and idempotency keys; never purge durable events to make a metric green.
- After recovery, replay from durable checkpoints, verify no duplicate external effect or charge,
  reconcile ambiguous commands, and compare authoritative database state with emitted events.

## Scheduled evidence

- Every release: all M9 gates, reviewed plan, canary, alarm health, and rollback target.
- Weekly: backup age, alarm delivery, secret age, reconciliation backlog, capacity headroom, and
  provider quota/cost review.
- Monthly and after material schema changes: isolated PostgreSQL restore drill.
- Quarterly: staging dependency outage drills, credential rotation, cross-workspace isolation,
  rollback rehearsal, and recovery-objective review.

# Failure recovery and disaster-recovery runbook

Control Plane authoritative state is PostgreSQL execution/event/usage/eval data and versioned object
storage. ECS tasks, gateways, workers, local process memory, telemetry, and cache are replaceable.
Recovery must never infer an uncertain external side effect: ambiguous provider/runtime outcomes enter
`reconciliation_required` and preserve their command, payload, attempt, and policy identities.

## Objectives

| State or service                    |                            RPO |        RTO | Recovery rule                                                     |
| ----------------------------------- | -----------------------------: | ---------: | ----------------------------------------------------------------- |
| Execution, event, and usage ledgers |         0 seconds after commit |  5 minutes | replay durable inbox/outbox and idempotency records               |
| PostgreSQL service                  |                      5 minutes | 60 minutes | Multi-AZ failover, then PITR/restore if required                  |
| Versioned object storage            | 0 seconds for accepted version | 60 minutes | select the last verified object version; never overwrite evidence |
| API, workers, gateways, cache       |                      0 seconds | 10 minutes | replace tasks and rebuild projections from authoritative records  |

## Automated drill

`bun run test:integration` now runs the complete database/LangGraph integration suite and a real
custom-format `pg_dump`/`pg_restore` drill between two isolated non-production databases. The drill
inserts immutable eval/execution-plan evidence, restores it, verifies the exact digest, and disposes
both databases through the shared isolated-database lifecycle. `bun run test:recovery` runs only the
restore portion when the local PostgreSQL service is already healthy and the three scoped database
URLs are present.

The M9 core lane also runs `bun run test:unit`, including executable failure and replay coverage in
`apps/workflow-worker/src/execution-workflow.test.mjs`,
`apps/runtime-gateway/src/reconnect-reconciliation.test.mjs`,
`packages/events/src/delivery.test.mjs`, and `packages/langgraph-adapter/src/index.test.mjs`.
PostgreSQL rollback and connection-loss behavior runs in
`packages/database/src/integration.test.mjs`; checkpoint restart and the real restore drill remain in
the integration lane. The `failureScenarios` catalog is an operator index for these implementations,
not standalone evidence that a scenario passed.

For an AWS drill, restore the selected RDS recovery point into a new isolated instance, deny all
application traffic, run schema/record/digest verification, and record observed RPO/RTO. Promotion
requires an operator to repoint a canary task, validate readiness and reconciliation backlog, and
then explicitly approve traffic movement. Never restore over the active production instance.

## Failure signatures and response

- `service.configuration_invalid` or startup failure: do not roll forward; compare digest-pinned task
  definition, secret versions, schema/protocol/adapter compatibility, and environment validation.
- PostgreSQL connection/failover errors: stop migrations, preserve inbox/outbox backlog, confirm RDS
  failover status, then replay from durable offsets after readiness.
- Temporal worker loss/replay: replace the worker; deterministic workflow replay must retain stable
  effect keys. A nondeterminism error blocks deployment and requires the previous worker revision.
- Runtime Gateway reconnect storm or ACK latency: apply admission/backpressure limits, retain command
  identity, and replay only queued or provably unacknowledged commands.
- Missing retained runtime outcome or partial provider response: mark reconciliation required; never
  retry a non-idempotent effect merely because an ACK is absent.
- Event delivery outage/dead letter: retain the ordered outbox record, repair the consumer, and replay
  from the last durable acknowledgement. Duplicate consumers must converge through idempotency keys.
- Checkpoint interruption: resume the exact graph/version/checkpoint lineage; incompatible graph code
  blocks resume and returns to the last certified worker revision.

Every drill or incident records timestamps, affected release and immutable versions, committed record
counts/digests, reconciliation/manual-intervention counts, observed RPO/RTO, operator decisions, and
cleanup evidence. Sensitive payloads and credentials are prohibited from the incident record.

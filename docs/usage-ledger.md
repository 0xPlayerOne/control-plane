# Authoritative usage ledger

`@control-plane/usage-ledger` records immutable reservation, model, tool, sandbox, adjustment,
release, settlement, refund, and credit entries. Every effect carries workspace, execution,
attempt, source, idempotency, unit, currency, funding, and time attribution. The PostgreSQL adapter
exposes append and ordered-read operations only; unique execution-sequence and workspace-idempotency
constraints prevent duplicate charge effects under retries and redelivery.

Executions reserve estimated or maximum cost before work. Charges are rejected when they exceed the
reservation, execution cost ceiling, or token ceiling. Unused reservation is released during a
deterministic settlement, and child executions inherit the lesser of their requested limit and the
parent's available authority. Extensions require a recorded policy authorization decision.

HQ-managed charges carry exact microunit attribution. External-subscription effects carry their
usage units but must record zero authoritative provider cost and `costExact: false`. Public summaries
aggregate safe units and funding classifications without exposing provider source IDs, idempotency
keys, credentials, or payloads.

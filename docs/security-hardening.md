# Production security invariants

Control Plane treats every HTTP request, Runtime Gateway frame, provider response, model/tool output,
checkpoint payload, and event as untrusted. Authorization is derived only from authenticated
principals, immutable ExecutionPlan constraints, scoped grants, and a versioned policy decision.
Natural-language content is data and cannot grant authority.

## Trust boundaries and assets

| Boundary                                   | Primary threats                                                           | Required controls                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Agent HQ to Control API                    | spoofing, cross-workspace access, replay                                  | purpose-bound service credentials, audience and scope checks, generic not-found denial              |
| RuntimeNode to Runtime Gateway             | node/workspace substitution, replay, stale ownership                      | device proof, generation claim, revocation, payload hash, durable duplicate-effect ledger           |
| Model, tool, MCP, and connector adapters   | prompt injection, confused deputy, secret egress                          | policy decision before execution, exact tool/model pins, scoped leases, output validation           |
| Sandbox                                    | path traversal, metadata access, ambient credentials, resource exhaustion | absolute bounded paths, deny-all/allowlist network, ephemeral leases, CPU/memory/time/output limits |
| PostgreSQL, events, checkpoints, telemetry | tenant leakage, tampering, repudiation                                    | workspace-scoped repositories, immutable evidence, idempotency keys, redaction, audit records       |

The protected assets are workspace data, execution authority, connector/provider credentials,
runtime identity, immutable plans and version pins, authoritative usage/cost records, artifacts, and
release evidence. Cache and telemetry remain non-authoritative.

## Enforced invariants

- Cross-workspace project, profile, context, runtime, tool, and usage reads or mutations fail closed
  with the same public `RESOURCE_NOT_FOUND` classification used for absent resources.
- Service, RuntimeNode, connector, and provider credentials are purpose- and audience-bound; one
  credential class cannot substitute for another.
- Child plans may narrow but never widen the parent's workspace, policy, runtime, model, tool,
  context, sandbox, budget, or delegation limits.
- Untrusted prompt, model, tool, MCP, and document content cannot create a grant or bypass approval.
- Secret material is used only inside a declared provider callback. It is prohibited from logs,
  traces, events, errors, model context, graph checkpoints, public APIs, and durable eval evidence.
- Gateway traffic is bound to the authenticated node, workspace, channel generation, command ID,
  and payload digest. Revoked, replayed, conflicting, and stale traffic is rejected before effects.
- Sandbox network access denies cloud metadata and undeclared hosts; path, resource, duration, and
  output bounds are checked before provider execution.

`bun run security:scan` scans tracked and untracked repository files for common production
credential formats without printing discovered secret material. Code Foundry separately runs the
native dependency audit, Dependency Review, and CodeQL. `bun audit` is the local lockfile advisory
gate; forced audit remediation is prohibited.

## Incident evidence

Preserve the normalized request/correlation/execution/attempt IDs, actor and credential kind (never
the credential), workspace and resource scope, policy decision ID/version, immutable plan and
adapter/runtime/tool/model versions, command and payload digests, event sequence, reconciliation
classification, affected release digest, first/last observed timestamps, and containment actions.
Do not copy prompts, file contents, provider payloads, tokens, cookies, or raw secrets into tickets or
telemetry. Rotate any exposed credential before history cleanup, and preserve the audit trail for the
rotation and revocation.

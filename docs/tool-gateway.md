# Tool Gateway contracts

The Tool Gateway is the privileged boundary between runtimes and tool executors. Runtimes receive
canonical, version-pinned tool grants; they do not receive connector, MCP, sandbox, or internal
executor credentials.

## Registry model

- `ToolDefinition` owns the stable public name and workspace/system scope.
- `ToolVersion` pins JSON input/output schemas, operations, capability requirements, risk and
  approval metadata, idempotency support, executor type/reference, and payload/time limits.
- Published semantic versions are immutable. A contract change requires a new `toolVersionId` and
  semantic version.
- Executor references are stable adapter slots. An implementation can be replaced without changing
  the public tool identity or pinned schema.

The registry exposes exact list, read, and resolve operations. Workspace-owned definitions are never
visible outside their workspace; system definitions are visible to all workspaces but still require
an explicit grant before execution.

## Execution boundary

Every invocation carries the exact tool definition/version, workspace, profile, operation, and audit
correlation. The gateway verifies that these fields match the grant before resolving an executor.
It validates and bounds both input and output around the executor call. Unknown versions,
unauthorized operations, missing executors, schema violations, and limit violations fail closed.

Executor adapters implement the provider-neutral `ToolExecutor` port from `@control-plane/tool-sdk`.
Provider credentials and transport configuration remain behind those adapters and are not part of
canonical definitions, runtime requests, or public results.

## Durable policy-controlled calls

Privileged execution uses `PolicyControlledToolExecutionService`, which prepares and validates the
canonical request before recording a `ToolCall`. The record stores an input digest rather than raw
input, the exact policy decision/version, approval and executor references, a stable idempotency key,
bounded results or Artifact references, and an append-only status history.

The service follows this order:

1. Validate the exact grant, version, operation, input schema, and input size.
2. Claim the workspace-scoped idempotency key and persist the request digest.
3. Evaluate the provider-neutral policy port; denial or evaluator failure cannot reach an executor.
4. Create or inspect a durable M3 approval interaction when policy/tool risk requires it.
5. Enforce the principal/tool/operation rate window immediately before the effect.
6. Invoke the executor with the pinned timeout and retry only errors explicitly classified by the
   tool version when its idempotency model supports retry.
7. Validate and bound output, then persist the result and terminal audit transition.

Concurrent and redelivered requests with the same digest converge on one supported effect. Reusing
an idempotency key with a different request fails closed. An unknown or committed effect that cannot
be safely replayed enters `reconciliation_required` instead of being reported as an ordinary failure.
Executor errors are normalized to bounded codes; raw error messages and raw tool input are not kept
in the durable call record.

## MCP servers

`McpAdapter` discovers a registered server through a provider-neutral client port and imports each
remote tool as a workspace-scoped canonical definition. Every imported version records the source
server, remote tool name/version, schema digest, and discovery time. A changed schema publishes a
new immutable version; an execution already pinned to the previous digest fails closed instead of
silently using the changed remote contract.

MCP calls use the same policy-controlled Tool Gateway path as every other executor. Disconnects,
removed tools, protocol errors, timeouts, invalid output, and oversized output are exposed as
bounded error codes. The server's vault or lease reference stays inside the adapter and is supplied
only to the server-side MCP client; it is excluded from registry records, runtime requests, durable
tool calls, audit results, and public APIs.

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

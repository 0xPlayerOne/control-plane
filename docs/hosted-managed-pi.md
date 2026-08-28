# Hosted managed Pi

`apps/runtime-worker` provides the managed-cloud execution path for `ManagedPiAdapter`. The adapter uses the same normalized and pinned configuration for local and hosted Pi; only the client boundary changes. A `RuntimeHostProvider` owns sandbox allocation, process lifecycle, and provider-specific implementation details.

## Authority and isolation

The worker sends the host a bounded launch request containing the normalized execution configuration, opaque model/tool authorization references, the exact sandbox CPU/memory/storage limits, and a deadline derived from the plan. It does not send provider credentials, arbitrary host paths, environment variables, executables, or ambient filesystem authority. The host rejects a plan before allocation when its duration or sandbox limits exceed provider capacity.

Untrusted code and tool operations remain inside the approved host and tool-provider boundaries. Model and tool grant references authorize provider-side resolution without persisting reusable provider secrets in the execution plan, prompt, adapter state, or worker state.

## Lifecycle and recovery

Launch is idempotent by the adapter command key and normalized request fingerprint. Cancellation moves the retained hosted attempt to a terminal cancelled state, cleanup releases its sandbox once, and reconciliation queries the provider-owned retained attempt after a worker restart. A worker crash is normalized as retryable infrastructure failure; ambiguous or conflicting idempotency is never retried implicitly within the same attempt.

Progress, usage, interactions, errors, and results flow through the ordinary `ManagedPiAdapter` normalization path. Persistent outputs are written through `HostedArtifactStore` and returned as Control Plane Artifact references rather than depending on worker-local disk.

## Registration, readiness, and scaling

Host inspection produces a normal `managed_cloud` RuntimeConnection at `agent_hq_cloud`, including verified capabilities, versions, health, freshness, and compatibility. Eligibility and routing therefore use the same Runtime SDK evaluation as every other runtime.

`HostedManagedPiWorker` exposes provider-neutral readiness and capacity demand. The bootstrap composition refuses readiness when the host is unavailable or has no capacity and closes the host provider during graceful shutdown. Scaling output contains only current slots, active work, queued work, and desired capacity; a deployment adapter may translate that signal for any approved container or sandbox provider.

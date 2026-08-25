# ACP runtime adapter

`@control-plane/acp-adapter` is the external-harness boundary for Agent Client Protocol (ACP)
version 2. It translates the stable `RuntimeAdapter` contract into ACP requests and normalizes ACP
updates and retained state back into Control Plane models. The domain, contracts, execution, and
Runtime SDK packages do not import ACP types or depend on an ACP implementation.

## Negotiation and eligibility

The adapter initializes with ACP protocol version 2 and records the exact version and agent metadata
returned by the peer. An unsupported protocol major, missing session surface, or disconnected
transport is reported as unavailable. Required Runtime capabilities must be present at their minimum
support level before execution starts; missing optional capabilities remain explicit in the capability
evaluation and never become inferred behavior.

ACP v2's baseline session surface maps to normalized create, list, resume, close, prompt, progress,
approval, cancellation, and tool-call capabilities. Resume does not imply history replay or loading.
Those operations remain unsupported until a peer exposes them independently and the adapter has a
tested mapping. Unknown additive ACP capability fields are ignored so compatible peers can extend the
protocol without changing the normalized contract.

## Translation and ownership

Start creates an ACP-native session and sends a bounded textual reference to the immutable execution
plan, attempt, digest, and authorized context package. The native session ID remains private to the
adapter; callers receive the supplied opaque external-session mapping. ACP updates become ordered
status, output, interaction, usage, and Artifact progress. Permission and elicitation responses,
cancellation, retained status, and cleanup are routed back through their native ACP identifiers.

The adapter does not authenticate the native harness, install or configure it, alter its MCP servers,
select its working directory, inject credentials, or assume ownership of its sessions. Native auth
methods returned during initialization are intentionally retained at the protocol edge and are not
exposed through `RuntimeAdapter`.

## Failure behavior and evidence

Protocol mismatch fails closed before creating a session. Disconnects are retryable availability
failures for new requests and reconcile retained attempts as `unknown`; prompt timeouts preserve their
timeout classification without an implicit retry. Idempotency conflicts are rejected rather than
executing a second native side effect.

The package includes a deterministic ACP transport covering negotiation, execution, permission,
cancellation, disconnect, timeout, native-session opacity, and the shared RuntimeAdapter conformance
suite. The transport is test evidence and a driver fixture, not a production process launcher.

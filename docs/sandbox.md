# Isolated sandbox execution

`@control-plane/sandbox` owns the provider-neutral boundary for untrusted code, shell, filesystem,
and ephemeral compute. Domain and runtime callers depend on `SandboxProvider`; the initial
`E2bSandboxAdapter` translates bounded requests through an E2B client port without exposing E2B SDK
types to core packages.

Every sandbox is correlated to a workspace, execution, and attempt and receives an explicit
template, lifetime, CPU, memory, storage, output, and network policy. Network access defaults to
denied, infrastructure metadata hosts are always rejected, and allowlisted hosts are forwarded to
the provider isolation layer. Ordinary environment input cannot contain credential-shaped fields.
Short-lived credential leases are resolved only inside the adapter immediately before execution and
are not retained in handles, status, errors, or promotion records.

The coordinator normalizes output and errors, bounds combined output, and deterministically destroys
the instance when execution times out, is cancelled, or fails. The reaper destroys expired abandoned
instances idempotently. Sandbox disk is ephemeral: a file becomes persistent only when an authorized
`ArtifactPromoter` accepts its bytes and returns a durable artifact reference.

# Connector credential vault

`@control-plane/credential-vault` separates provider credentials from Agent HQ sessions, runtime-node
identity, and ordinary Control Plane service authentication. Public credential metadata contains a
stable credential ID, workspace/connector ownership, provider name, status, revision, and lifecycle
timestamps. Encrypted secret locators and KMS references remain internal vault records.

Long-lived values are stored through the provider-neutral `SecretProvider`. The initial
`AwsSecretsManagerProvider` maps that port to a narrow AWS Secrets Manager client interface and a
KMS key reference; core contracts contain no AWS SDK types. The in-memory provider exists only for
deterministic tests.

## Scoped use

Tool Gateway or another approved server-side adapter requests a short-lived lease after an explicit
`credential:lease` PDP decision. A lease is pinned to one workspace, principal, credential revision,
operation, resource, policy snapshot, and maximum five-minute lifetime. It exposes only an opaque
`lease://` capability reference. Use is single-shot and rechecks expiry, revocation, and exact scope
before decrypting.

The raw value exists only as the argument to the provider callback. The vault rejects callback
results containing the secret or credential-shaped fields and normalizes callback/provider errors,
so reusable credentials cannot flow into runtime/model results or ordinary errors. Audit events
record stable IDs, revisions, actors, policy reason codes, and timestamps only.

Rotation adds a new encrypted revision while preserving the stable credential and connector IDs.
Existing revision-pinned leases remain explicit; new leases select the current revision. Revocation
blocks new leases, invalidates active leases, and asks the secret provider to revoke every retained
revision. Missing policy, PDP failure, scope mismatch, expiry, replay, or provider failure all fail
closed.

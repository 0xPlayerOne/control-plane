# Runtime Gateway protocol

`@control-plane/runtime-gateway-protocol` is the provider-neutral, versioned wire contract between the cloud Runtime Gateway and outbound RuntimeNode connections. It is distinct from the product HTTP/SSE API and never carries user-session or reusable device/provider credentials.

## Envelope and delivery rules

Every envelope identifies its schema and negotiated protocol version, node, workspace, channel generation, sequence, trace, and send time. Commands additionally require a stable command ID, idempotency key, content digest, issue/expiry timestamps, driver family/version, capability requirements, and semantic command family. Transport is at least once: redelivery reuses the same command ID and payload hash, while a hash mismatch fails closed.

Payloads are either bounded adapter-owned JSON or a content-addressed Artifact reference. Core validation rejects native provider command types and selectors for arbitrary endpoints, local paths, executables, databases, projects, source scopes, or reusable credentials. Context-provider status/read operations are optional; writes require a separate authorization reference. Inventory may advertise zero providers without affecting runtime negotiation.

The checked-in JSON Schema and golden/malformed JSON fixtures under `packages/runtime-gateway-protocol` are language-neutral. The TypeScript package depends only on Zod and includes a deterministic reference RuntimeNode plus a reusable conformance runner; consumers do not need Control Plane server, domain, or database packages.

## Channel authentication

The WebSocket upgrade uses a separate short-lived `runtime_node` credential and a proof signed by the registered device key. The public package owns only normalized credential claims, the bounded authentication-attempt schema, and the replaceable `RuntimeNodeIdentityValidationPort`; a consuming application remains responsible for node registration, pairing, key custody, and credential issuance. User-session, provider, and reusable device credentials are not command envelopes.

The gateway checks the exact issuer, gateway audience, node, workspace, revocation version, expiry, proof challenge, and monotonically increasing channel generation. A credential ID may establish only one channel. Re-authentication requires a newly issued credential and a higher channel generation; it replaces the prior logical channel. Revocation notifications invalidate the active channel immediately, and command authorization rechecks the revocation port before allowing another command. Audit events contain normalized codes and scope IDs, never compact credentials, signatures, or private key material.

The synthetic authority in the private Runtime Gateway app exists only for standalone conformance tests. Its generated Ed25519 private keys model RuntimeNode-owned test material and are never passed to `RuntimeNodeChannelAuthenticator`; production deployments replace its validation port with the consuming application's registry and verifier.

## WebSocket lifecycle and horizontal scale

The dedicated Runtime Gateway upgrade endpoint is `/runtime-gateway/v1/connect`. Its upgrade authenticator must return an already verified `RuntimeNodeChannel`; ordinary Control API handlers and user sessions are not involved. The Bun server adapter configures native maximum payload, backpressure, and idle limits, while the lifecycle applies the same bounds before JSON parsing. Invalid hello, scope, version, frame, or ownership state closes with a bounded normalized reason.

An authenticated socket becomes active only after its hello negotiates a supported protocol version and claims a monotonically increasing channel generation through `RuntimeNodeCoordinationPort`. The port is replaceable by shared coordination such as a compare-and-set Redis implementation. A higher generation atomically claims the node and notifies the old gateway instance to close its stale socket; an equal or lower generation fails closed. Correctness therefore does not require load-balancer stickiness, and reconnecting to another instance does not move or delete command/result state. Durable delivery remains outside gateway process memory and is connected to this lifecycle through the M5 command ledger.

Heartbeats refresh shared ownership and publish normalized online/degraded/offline changes through `RuntimeNodeReachabilityPublisher`. A stale heartbeat degrades the node; the idle deadline releases ownership and marks it offline. Graceful shutdown stops admission, closes and releases each active channel, and then stops the native server. Metrics record per-instance active nodes, reconnects, heartbeat lag, negotiated protocol versions, and normalized disconnect reasons.

## Compatibility and deprecation

Peers negotiate the highest common major version and the lower supported minor within that major. No common major fails negotiation. Additive fields and envelope variants require a minor version; changed meanings, required-field removal, or incompatible validation require a new major. Deprecation must name the affected version and timestamp; an optional sunset must be later than deprecation and should name a supported replacement. A command already past expiry is never made valid by protocol negotiation or reconnect.

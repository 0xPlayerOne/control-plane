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

## Compatibility and deprecation

Peers negotiate the highest common major version and the lower supported minor within that major. No common major fails negotiation. Additive fields and envelope variants require a minor version; changed meanings, required-field removal, or incompatible validation require a new major. Deprecation must name the affected version and timestamp; an optional sunset must be later than deprecation and should name a supported replacement. A command already past expiry is never made valid by protocol negotiation or reconnect.

# Runtime capabilities and compatibility

`@control-plane/runtime-sdk` defines the Control Plane-owned vocabulary for runtime discovery,
eligibility, routing, and future adapter operations. The vocabulary is provider and harness neutral;
Pi, ACP, and mock fixtures use the same schemas and no concrete runtime SDK is a dependency.

## Runtime records and ownership

A `RuntimeDefinition` identifies a normalized runtime family and records adapter, driver, and harness
versions, location, health, lifecycle, capabilities, tested-version metadata, and limitations.
`RuntimeNodeRef` is an opaque reference to Agent HQ-owned device identity. It always declares
`authority: agent_hq`; the Control Plane neither recreates nor owns that identity.

A Control Plane-owned `RuntimeConnection` links its opaque connection ID to one RuntimeNode reference
and one RuntimeDefinition. It contains only normalized health, status, negotiated capabilities,
limitations, and freshness time. Raw paths, credentials, process handles, and native configuration are
not schema fields and are stripped from read models.

## Capability requirements

Capabilities are individually named and report supported, degraded, or unsupported state plus bounded
limitations. Session create, list, resume, close, history, and load are six independent capabilities;
none implies another. Other normalized capabilities cover streaming, tools, structured output,
filesystem/project access, cancellation, user input, approvals, model selection, and child execution.

Requirement expressions mark every capability required or optional and declare whether degraded
support is sufficient. Duplicate or contradictory requirements are invalid. Evaluation is
deterministic and sorted:

- missing, unsupported, or insufficient required capabilities make the runtime ineligible;
- missing or degraded optional capabilities produce degraded eligibility with explicit reasons;
- all satisfied requirements produce full eligibility.

## Compatibility states

Compatibility assessment checks lifecycle and health first, then declared compatibility, contract,
adapter and driver major versions, and finally capability requirements. Results are explicit:
compatible, degraded, untested, incompatible, deprecated, revoked, unavailable, or
capability-missing. No version or capability is inferred from a related operation.

Tested-version metadata records the exact public contract, adapter, driver, and harness versions used
to establish compatibility. Equality helpers compare parsed normalized definitions and capability sets
independent of capability ordering. These models describe future adapters only; they do not implement
discovery, installation, native authentication, session behavior, or concrete Pi/ACP execution.

# AgentProfile and Skill versioning

The Control Plane owns executable AgentProfile and Skill configuration. Agent HQ owns the persistent,
user-facing Agent and stores only an explicit `{ profileId, profileVersionId }` pin. Publishing another
version never changes that pin, and Agent HQ does not copy the composed runtime configuration into its
product database.

## Catalog records and ownership

`AgentProfile` and `Skill` are stable catalog records. Their versions carry the executable content.
Ownership is one of system, workspace, organization reference, or private principal reference. These
references scope lookup and authorization without copying Agent HQ membership or permission rules into
the Control Plane.

AgentProfile definitions contain role/persona instructions, exact SkillVersion references and digests,
capability requirements, one immutable provider-neutral `ExecutionConstraintSet`, and output-contract
references. The constraint set covers context, tools, logical models, runtimes, policy snapshots,
interaction, budgets, and execution limits; see [`execution-constraints.md`](execution-constraints.md).
Skill manifests contain a semantic version, content digest, capabilities/tools, profile and public-contract
compatibility, and optional evaluation references. Concrete harness, provider credential, process, and
local-path details do not belong in either model.

## Publication and immutability

Draft content may be replaced only with its current revision. Publication computes and preserves a
SHA-256 digest over canonical key-ordered JSON, increments the revision through repository
compare-and-set, and rejects duplicate profile version numbers or Skill semantic versions. Repository
adapters must enforce those uniqueness rules atomically; the in-memory adapter demonstrates the port
semantics and is intended for tests, not durable deployment.

Published content cannot return to draft or be replaced. Lifecycle transitions create a new revision
that preserves the exact content and digest:

- `published` is available for new exact pins.
- `deprecated` remains resolvable with an explicit remediation signal.
- `superseded` remains resolvable and names the published successor; adoption is still explicit.
- `revoked` remains identifiable for provenance but is blocked for compilation/execution.
- `draft` resolves as unpublished and is never eligible for execution.

Deprecation, revocation, and supersession record timestamps and reasons or successor IDs. A successor
must be published and belong to the same stable profile or Skill.

## Resolution and compatibility

Resolution always uses the stable record ID plus exact version ID. Skill resolution additionally
matches the immutable content digest. Results are explicit: available, deprecated, superseded, revoked,
unpublished, missing, or incompatible. Compatibility checks report deterministic reasons for missing
capabilities/tools, missing or revoked Skills, digest drift, and incompatible profile-schema or public
contract majors. These checks are inputs to later ExecutionPlan compilation; they do not silently
select a newer version.

`AgentProfileRepository` and `SkillRepository` are persistence ports. Durable adapters must retain
historical versions, return defensive snapshots, and implement revision compare-and-set plus published
version uniqueness in one transaction. A concurrent publish has exactly one winner; losers receive an
explicit revision or version conflict and must reload before retrying.

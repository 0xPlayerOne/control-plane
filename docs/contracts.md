# Agent HQ ↔ Control Plane contracts

`@control-plane/contracts` is the runtime-independent service boundary between Agent HQ and the
Control Plane. Agent HQ supplies authorized product intent and workspace identity; the Control Plane
applies execution policy and owns runtime semantics. The package depends only on Zod and can build
without Control Plane domain, database, application, workflow, or adapter packages.

## Canonical identifiers

Identifiers are opaque, prefix-qualified ULIDs. Consumers may validate and compare them, but must not
derive database keys, timestamps, routing decisions, filesystem paths, or vendor-native identifiers
from their contents.

| Identifier            | Prefix |
| --------------------- | ------ |
| Request               | `req_` |
| Command               | `cmd_` |
| Workspace             | `wsp_` |
| Project               | `prj_` |
| Task                  | `tsk_` |
| Agent                 | `agt_` |
| AgentProfile          | `prf_` |
| AgentProfileVersion   | `pfv_` |
| SkillVersion          | `skv_` |
| Execution             | `exe_` |
| Attempt               | `att_` |
| Workflow              | `wfl_` |
| Interaction           | `int_` |
| RuntimeNode reference | `rnr_` |
| RuntimeConnection     | `rtc_` |
| External session      | `ses_` |
| Artifact reference    | `art_` |
| Event                 | `evt_` |
| Trace                 | `trc_` |

Prefixes prevent accidental identifier substitution; the suffix remains opaque. Runtime-native
workflow/session IDs, database UUIDs, process handles, local paths, and credentials are never public
identifiers.

## Envelopes

All public envelopes carry `{ major, minor }` `contractVersion` metadata and purpose-built public
data rather than persistence rows.

- Read requests carry request, workspace/project, operation, timestamp, and trace/correlation data.
- State-changing commands additionally require a command ID, idempotency key, and canonical payload
  hash. The hash is lowercase SHA-256 over RFC 8785 canonical JSON bytes. Reusing an idempotency key
  with a different hash is a conflict; retrying the same key and hash is safe.
- Responses contain either `data` or a normalized `error` plus request/correlation metadata.
- Events identify the event, workspace/project, occurrence time, causation, and normalized data.
- Usage records expose provider-neutral token, duration, and optional ISO-currency cost totals.
- Artifact references expose an opaque locator, media type, immutable version, size, and SHA-256
  digest—not a database row or provider credential.
- Runtime read models expose Control Plane status and opaque RuntimeNode/connection references. They
  never expose local paths, device credentials, process handles, or native harness configuration.

Browser/user credentials, Agent HQ service credentials, RuntimeNode device credentials, and
provider/harness credentials are distinct trust boundaries. None belongs in these generic payloads.

## Error classification

Normalized errors use one of: `validation`, `authentication`, `authorization`, `conflict`,
`stale_reference`, `capability_mismatch`, `runtime_unavailable`, or `internal`. The stable machine
code and retryable flag refine the class. Public messages are bounded and must not contain credentials,
stack traces, queries, or persistence details.

## Compatibility and negotiation

The current boundary is `1.0`.

- A major version change is breaking. Removing or renaming fields, making an optional field required,
  narrowing valid values, or adding a closed-enum value requires a major version.
- A minor version is additive only. New fields must be optional, defaults must preserve prior
  behavior, and producers must continue accepting the earlier same-major form.
- Envelope schemas tolerate unknown additive fields so an older same-major consumer can safely parse a
  newer producer. Consumers use only the recognized result.
- Peers advertise supported versions. Negotiation selects the highest common major and the lower of
  each peer's highest supported minor for that major. No common major fails closed before dispatch.
- Deprecations record their effective time, an optional later sunset, replacement version, and
  documentation. A sunset cannot precede deprecation. Removing a supported major requires the
  announced breaking-version path.

`PublicContractFixtures` supplies deterministic provider and consumer fixtures. Compatibility tests
must parse both the current fixture and same-major additive variants; a breaking change must update
the major boundary explicitly.

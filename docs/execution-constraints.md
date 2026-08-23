# Execution constraints

AgentProfile versions carry a provider-neutral `ExecutionConstraintSet`. The same immutable value is
the input to ExecutionPlan compilation. Stable domain code does not import MCP, LiteLLM, Cedar, AWS,
or connector SDKs; gateways and adapters resolve the references later.

## Tool authority

Tool access is always deny-by-default. A grant identifies a logical tool and version range, the exact
operations and capabilities requested, a risk class, and an approval mode. A grant for `read` never
implies `write`, and an unknown tool or operation is denied. Concrete protocol names, endpoints, and
credentials are not part of the contract.

Risk classes progress from `safe` and `read` through `write`, `destructive`, and `privileged`.
Approval modes are explicit: `none`, `per_execution`, `per_operation`, or `always`.

## Model and policy requirements

Model requests use logical aliases such as `reasoning.standard`, capability requirements, permitted
provider classes, denied-provider policy, data residency, and a bounded fallback class. User-authored
constraints cannot name an arbitrary provider/model pair.

`PolicySnapshotReference` pins the policy identity, version, and digest used to compile or authorize
an execution. `AuthorizationDecisionInput` supplies evaluator-neutral principal, action, resource,
workspace, snapshot, and context values. A later adapter may evaluate these with Cedar or another
engine without changing the domain contract.

## Limits and interaction

Every constraint set specifies cost in USD microunits, total tokens, duration, parallel concurrency,
child-execution count and depth, plus sandbox CPU, memory, and storage. Values are positive except
child count and depth, which may explicitly be zero. Interaction policy independently controls
approvals, user input, destructive operations, and approval expiry.

## Composition

`composeExecutionConstraints` only narrows authority:

- context classifications, tool operations, model provider classes, data residency, runtime families,
  and runtime locations are intersected;
- required capabilities and denied providers are combined;
- numeric limits use the lowest ceiling;
- risk and approval requirements become stricter;
- policy snapshots must match exactly.

An empty required intersection, mismatched policy snapshot, or `disabled`/`required` interaction pair
throws a deterministic `CONSTRAINT_CONFLICT:<path>` error. Composition never silently chooses a
provider or widens access. Fixtures cover safe, read-only, write, privileged, and budget-constrained
profiles.

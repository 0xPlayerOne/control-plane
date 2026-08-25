# Managed model gateway

`@control-plane/model-gateway` is the server-only boundary for HQ-funded managed model calls. An
ExecutionPlan and runtime request identify a logical alias and required capabilities; they never
select an arbitrary provider endpoint, SDK type, model credential, or raw provider configuration.

`ManagedModelGateway` validates bounded messages/settings, resolves an approved alias deployment,
enforces the plan's provider class, denied-provider, residency, and capability constraints, then
requires a `model:invoke` PDP decision before calling an adapter. Provider adapters implement a
replaceable completion/streaming/health/cancellation port. `LiteLlmAdapter` is the initial adapter;
LiteLLM field names and its server-side credential reference do not enter domain or runtime
contracts.

Completion and stream results normalize input, output, cache, reasoning, and total token counts,
finish reasons, latency, trace correlation, provider/model/request metadata, policy snapshot, and
funding source. `hq_managed` calls therefore remain distinguishable from
`external_subscription` harness usage for the authoritative HQ ledger added later in M7.

Routing is deterministic and auditable. The registry filters disabled or unhealthy deployments,
then applies capability, plan, entitlement, residency, context/output, and cost constraints before
the PDP evaluates any candidate. Eligible routes are ranked by configured priority, cost class, and
deployment identifier. Results record the selected deployment, router version, ordered eligible
candidate identifiers, and any fallback origin without exposing credentials. Fallback occurs only
after a retryable provider failure and only to another candidate that already passed every policy
and budget constraint; equivalent inputs and registry state therefore produce the same route.

Unknown aliases, incompatible plan constraints, policy denial/evaluator failure, missing adapters,
timeouts, provider errors, and stream failures fail closed with bounded codes. Raw prompts,
credentials, provider response bodies, and exception messages are not copied into normalized errors.
The deterministic fake adapter exercises the same provider-neutral contract in CI.

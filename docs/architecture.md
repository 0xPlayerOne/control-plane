# Architecture baseline

The Control Plane is a TypeScript modular monolith with independently deployable composition roots.
Stable domain and contract packages point inward; infrastructure and vendor integrations attach through
adapter-bound ports. This baseline keeps the foundation ready for independent contracts, context,
execution, and runtime worktrees without allowing those lanes to redefine ownership.

## System ownership

| System               | Owns                                                                                                           | Does not own                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **Agent HQ**         | Product identity, organizations, workspace authorization, memberships, and the user-facing control surface     | Execution policy, runtime semantics, or worker scheduling |
| **Control Plane**    | Execution policy, runtime semantics, plans, context compilation, tool policy, orchestration, and audit records | Product identity or workspace authorization               |
| **RuntimeNode**      | The runtime-side protocol endpoint and lifecycle that executes an accepted Control Plane request               | Product authorization or Control Plane policy decisions   |
| **Concrete harness** | An environment-specific implementation used to run a RuntimeNode, such as a local process or sandbox adapter   | Stable contracts or domain policy                         |

Agent HQ authenticates the caller and supplies an authorized workspace identity. Control Plane treats
that assertion as an input, applies execution policy, and owns the runtime semantics of the resulting
work. RuntimeNode and a concrete harness remain distinct: the node is the stable execution protocol;
the harness is a replaceable way to host it.

## Repository ownership

- `apps/control-api` owns synchronous API composition and health endpoints.
- `apps/workflow-worker` owns durable orchestration composition.
- `apps/runtime-worker` owns queued runtime execution composition.
- `apps/runtime-gateway` owns runtime-facing transport composition.
- `apps/tool-gateway` owns tool-facing transport composition.
- `packages/domain`, `contracts`, `events`, `execution-plan`, `policy`, `context`, `runtime-sdk`, and
  `tool-sdk` own stable models and ports.
- `packages/database`, `telemetry`, `bootstrap`, and future named adapters own infrastructure details.

Applications may select concrete adapters. Stable packages must not import applications, vendor SDKs,
or another package's source tree. `bun run check:boundaries` enforces these directions and provides the
required forbidden-import regression test.

## Technology decisions

| Technology | Status        | Foundation decision                                                                                                   |
| ---------- | ------------- | --------------------------------------------------------------------------------------------------------------------- |
| TypeScript | accepted      | Primary application and package language under strict workspace settings.                                             |
| NestJS     | accepted      | Control API composition and dependency-injection framework.                                                           |
| Fastify    | accepted      | HTTP adapter beneath NestJS and for lightweight transport boundaries.                                                 |
| PostgreSQL | accepted      | Durable relational store, accessed through an owning service boundary.                                                |
| Drizzle    | accepted      | Schema and migration implementation inside `packages/database`.                                                       |
| Temporal   | accepted      | Durable outer execution lifecycle in `apps/workflow-worker`; runtime effects remain behind idempotent activity ports. |
| LangGraph  | adapter-bound | Optional graph execution integration; stable packages cannot import it.                                               |
| Pi         | adapter-bound | Optional agent-runtime integration behind runtime ports.                                                              |
| ACP        | adapter-bound | External agent protocol implemented at a gateway boundary when required.                                              |
| MCP        | adapter-bound | Tool protocol implemented at the tool gateway boundary.                                                               |
| LiteLLM    | adapter-bound | Model-routing provider behind a model gateway port.                                                                   |
| E2B        | adapter-bound | Concrete remote sandbox harness; adoption is deferred until runtime work.                                             |

“Accepted” means the foundation may depend on the technology at its stated boundary. “Adapter-bound”
means the domain cannot depend on it and a replaceable adapter is mandatory. “Deferred” means no
production rollout is implied by this baseline.

## Data ownership

Each service or bounded module owns its schema, migrations, credentials, transactions, and recovery
procedure. Other components use the owner's contract; they never read or write its tables directly.
The invariant is **no-cross-database-access**. A transaction cannot span databases, and a deployment
cannot depend on another service's migration running as an incidental side effect.

The M1 database package proves zero-state migration, deterministic replay, rollback recovery, and
isolated transactions. A clean database must become healthy through the documented migration command,
without manual SQL or state surgery.

## Parallel delivery invariants

The contracts, context, execution, and runtime worktrees may proceed independently after M1. They must
preserve stable package exports, declare workspace dependencies, add adapters outside inward-facing
packages, and integrate through pull requests. Changes that blur Agent HQ, Control Plane, RuntimeNode,
or concrete harness ownership require an architecture update and explicit review.

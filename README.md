# Control Plane

Production-shaped TypeScript monorepo for the Control Plane. The repository is organized as a
modular monolith with independently deployable workers and gateways, not as one microservice per
domain.

## Prerequisites

- Node.js 24.18.0 (`.node-version`)
- Bun 1.3.14 (`.bun-version` and `packageManager`)

Newer compatible Bun 1.x patch releases may run the workspace, but the pinned version is the
reproducible baseline.

## Getting started

```sh
bun install --frozen-lockfile
bun run build
bun run lint
bun test
```

Run `bun install` without `--frozen-lockfile` only when intentionally updating dependencies.
Service environment and startup conventions are documented in
[`docs/configuration.md`](docs/configuration.md). PostgreSQL schema, migration, credential, and
recovery conventions are documented in [`docs/database.md`](docs/database.md). Control API transport,
dependency, validation, and error conventions are documented in [`docs/api.md`](docs/api.md).
The versioned Agent HQ service boundary, service authentication, canonical identifiers, envelopes,
and compatibility policy are documented in [`docs/contracts.md`](docs/contracts.md).
Immutable AgentProfile and Skill ownership, publication, lifecycle, pinning, and compatibility are
documented in [`docs/profiles-and-skills.md`](docs/profiles-and-skills.md).
Runtime definitions, normalized capabilities, RuntimeNode references, connections, and compatibility
states are documented in [`docs/runtime-capabilities.md`](docs/runtime-capabilities.md).
Provider-neutral tool, model, policy, interaction, and execution-limit contracts are documented in
[`docs/execution-constraints.md`](docs/execution-constraints.md).
Revisioned canonical project context, provenance, CAS conflicts, history, and reviewed execution-output
promotion are documented in [`docs/project-state.md`](docs/project-state.md).
Reproducible bounded ContextPackage compilation, classified reference failures, and child-scope
narrowing are documented in [`docs/context-packages.md`](docs/context-packages.md).
Immutable ExecutionPlan compilation, resolved version pins, content-addressed persistence, and child
authority narrowing are documented in [`docs/execution-plans.md`](docs/execution-plans.md).
The publishable Agent HQ client, deterministic stub harness, OpenAPI compatibility gate, and package
versioning policy are documented in [`docs/sdk.md`](docs/sdk.md).
Container, Terraform, environment, migration, rollout, and rollback conventions are documented in
[`docs/infrastructure.md`](docs/infrastructure.md).
Production observability, security, recovery, capacity, release, and incident procedures are
documented in [`docs/telemetry.md`](docs/telemetry.md),
[`docs/security-hardening.md`](docs/security-hardening.md), [`docs/recovery.md`](docs/recovery.md),
[`docs/performance.md`](docs/performance.md), and [`docs/operations.md`](docs/operations.md).
System boundaries, technology decisions, and service ownership are documented in
[`docs/architecture.md`](docs/architecture.md).

## Architecture and governance references

- [`docs/architecture/diagram-sources.md`](docs/architecture/diagram-sources.md) contains the version-controlled Mermaid definitions for Control Plane-owned execution, context, RuntimeAdapter, and ProjectState diagrams.
- [`docs/runtime-compatibility/README.md`](docs/runtime-compatibility/README.md) explains the machine-readable runtime compatibility baseline and certification semantics.
- [`.github/labels.yml`](.github/labels.yml) defines the shared issue-label taxonomy without installing a synchronization workflow.
- Canonical TDDs, specifications, ADRs, roadmap decisions, and terminology remain in the Agent HQ Google Docs corpus.

## Workspace commands

| Command                      | Purpose                                                                    |
| ---------------------------- | -------------------------------------------------------------------------- |
| `bun run build`              | Build every app and package through Turborepo                              |
| `bun run lint`               | Lint source, lint repository configuration, and enforce package boundaries |
| `bun test`                   | Run every package's Bun tests and the repository acceptance tests          |
| `bun run test:acceptance`    | Validate the M1 foundation and M2 core-domain acceptance baseline          |
| `bun run check:boundaries`   | Reject undeclared dependencies and cross-package source imports            |
| `bun run format`             | Format the repository with Prettier                                        |
| `bun run format:check`       | Check formatting without modifying files                                   |
| `bun run containers:print`   | Print the five-service Buildx Bake plan without building images            |
| `bun run containers:build`   | Build the five production-shaped service images                            |
| `bun run infra:fmt:check`    | Check Terraform formatting using Terraform or Docker                       |
| `bun run infra:validate`     | Initialize and validate all three isolated Terraform roots                 |
| `bun run test:m9-acceptance` | Run the production hardening, secret scan, and load release gate           |

## Architecture map

### Deployable applications

- `apps/control-api`: synchronous Control Plane API composition root
- `apps/workflow-worker`: durable workflow execution worker
- `apps/runtime-worker`: runtime execution worker
- `apps/runtime-gateway`: runtime-facing gateway
- `apps/tool-gateway`: tool-facing gateway

Applications are composition roots. They may select concrete infrastructure and vendor adapters, but
business rules belong in stable packages.

### Stable interfaces and core domain

- `packages/domain`: domain entities, values, and invariants
- `packages/contracts`: versioned service and integration contracts
- `packages/control-sdk`: publishable Agent HQ-facing typed client and contract-test harness
- `packages/events`: stable domain and integration event definitions
- `packages/execution-plan`: execution-plan model and compilation ports
- `packages/runtime-sdk`: runtime-facing ports and SDK surface
- `packages/tool-sdk`: tool-facing ports and SDK surface
- `packages/policy`: policy model and evaluation ports
- `packages/context`: context model and compilation ports

These packages form the inward-facing platform boundary. They must not import Pi, ACP, LangGraph,
LiteLLM, E2B, Temporal, or another concrete vendor adapter. ESLint enforces that restriction, and
`turbo boundaries` rejects undeclared package dependencies and imports that reach into another
package's source tree.

### Infrastructure and support

- `packages/acp-adapter`: ACP v2 protocol negotiation and RuntimeAdapter normalization boundary
- `packages/database`: persistence implementation boundary
- `packages/telemetry`: observability implementation boundary
- `packages/testing`: shared test fixtures and harnesses

Concrete integrations added later should be isolated in clearly named adapter or infrastructure
packages and depend inward on the stable contracts above. Stable packages must never depend back on
those integrations.

## Package rules

Packages are private and server-only (`browser: false`) except the explicitly public
`@control-plane/contracts` and `@control-plane/sdk` packages. Library exports expose only declared
`dist` entry points; deep imports into `src` are unsupported. Workspace dependencies must be declared
in the importing package's manifest using Bun's workspace protocol. TypeScript runs in strict mode
for every app and package.

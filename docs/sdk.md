# Control Plane public SDK

The Agent HQ-facing boundary is distributed as two Apache-2.0 npm packages:

- `@control-plane/contracts` contains the versioned Zod schemas, public request/response/event/error
  types, compatibility rules, and deterministic fixtures.
- `@control-plane/sdk` depends on the contracts package and contains the typed HTTP client, operation
  registry, generated OpenAPI document, and `@control-plane/sdk/testing` stub harness.

Both packages are server-only. Their unreleased manifests remain `0.0.0`; Release Please tracks both
packages and owns the coordinated first `1.0.0` bump. Neither package exports Control Plane
database models, Drizzle schemas, application modules, Temporal workflows, policy evaluators,
ExecutionPlan compilers, runtime adapters, provider credentials, or secret-management code. ESLint
and package-surface tests enforce that dependency direction.

## Client boundary

`ControlPlaneClient` accepts a Control Plane base URL and a service credential or async credential
provider. Remote URLs must use HTTPS; loopback HTTP is accepted only for deterministic tests. The
client validates every request before transport, rejects redirects, sets request/correlation headers,
uses a bounded timeout, validates every response, rejects incompatible API majors, and throws
`ControlPlaneClientError` for normalized failures without retaining the bearer credential.

| Client method              | Operation                 | HTTP path                      |
| -------------------------- | ------------------------- | ------------------------------ |
| `verifyAuthentication`     | `authentication.verify`   | `/v1/authentication/verify`    |
| `resolveProfile`           | `profile.resolve`         | `/v1/profiles/resolve`         |
| `resolveProjectState`      | `project-state.resolve`   | `/v1/project-states/resolve`   |
| `resolveContextPackage`    | `context-package.resolve` | `/v1/context-packages/resolve` |
| `listRuntimes`             | `runtime.list`            | `/v1/runtimes/list`            |
| `validateExecutionRequest` | `execution.validate`      | `/v1/executions/validate`      |

Execution validation consumes exact profile/skill, ProjectState, ContextPackage, policy, runtime,
and output-contract references. Its public success result is only the immutable
`{ executionPlanId, contentDigest }` reference defined by issue #17; compiler inputs and internal plan
contents remain server-owned.

```ts
import { ControlApiFixtures, ControlPlaneClient } from '@control-plane/sdk'

const client = new ControlPlaneClient({
  baseUrl: 'https://control-plane.example',
  credential: async () => serviceCredentialProvider.current(),
})

const result = await client.validateExecutionRequest(ControlApiFixtures.executionValidation.request)
```

The current Control API application does not yet mount these domain operations. Agent HQ integration
must use the stub until the corresponding provider endpoints land; this prevents the SDK from
pretending M3 execution exists.

## Deterministic contract tests

The loopback-only stub implements every public SDK operation with the same schemas and deterministic
fixtures used by provider tests:

```ts
import { ControlPlaneClient } from '@control-plane/sdk'
import { createControlPlaneStub } from '@control-plane/sdk/testing'

const stub = await createControlPlaneStub()
const client = new ControlPlaneClient({
  baseUrl: stub.url,
  credential: 'stub-agent-hq-token',
})

try {
  // Exercise Agent HQ integration against client methods here.
} finally {
  await stub.close()
}
```

The harness validates authentication and payloads, caps bodies at 1 MiB, returns normalized errors,
records only operation/request metadata, and never records authorization values. Packed-tarball tests
install both packages into an isolated temporary consumer, type-check usage, and import both public
entry points without monorepo source access.

## OpenAPI generation and compatibility

The operation registry is the source for both client methods and
`packages/control-sdk/openapi/control-plane.v1.json`. Run:

```sh
bun run --cwd packages/control-sdk openapi:generate
bun run --cwd packages/control-sdk openapi:initialize-baseline # only for a new contract major
bun run openapi:check
```

`openapi:generate` never rewrites a compatibility baseline. The first commit for a new contract
major uses the explicit `openapi:initialize-baseline` command; it fails if that major already exists
on the target branch.

The repository-wide check regenerates the document in memory, detects artifact drift, and compares it
with the immutable v1 compatibility baseline. Removing operations or fields, adding required request
fields, removing required response fields, changing types/constants, or changing a closed enum fails
the v1 gate. Such changes require a new contract major and a new versioned baseline. Additive optional
fields remain compatible within the current major.

## Publishing and deprecation policy

Publish `@control-plane/contracts` before `@control-plane/sdk`; after the first release, the packed SDK
converts its workspace dependency to `@control-plane/contracts@^1.0.0`. Registry scope ownership and
provenance-enabled CI must be configured before setting Code Foundry's `npm_publish` toggle to true.
Local validation and the current CI configuration do not publish packages.

Contract and SDK majors match the public API major. Additive schema changes increment the contract
minor and both package minors. Implementation-only client or harness fixes may increment only the SDK
patch. Breaking schema or behavior changes require a new major, a new versioned OpenAPI boundary, and
an Agent HQ compatibility update.

Deprecations must use `ContractDeprecationSchema` with an effective time, documentation, optional
replacement, and a sunset later than deprecation. Deprecated exports remain available through their
current major. A supported major is removed only in a later major after its announced sunset; clients
with no common supported major fail before dispatch.

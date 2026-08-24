# Continuous integration

Code Foundry v0.37.5 is the CI control plane for this repository. Its generated
callers are pinned under `.github/workflows/` and target `main` directly; there
is no staging branch.

## Required pull-request gate

`Validation / Gate` is the single stable required check. For an ordinary pull
request it fans out CI, tests, and security as independent parallel jobs, then
aggregates their results. Each workflow cancels superseded work for the same
branch while unrelated pull requests, scheduled audits, and manual runs remain
parallel. Turborepo schedules build work from its dependency graph, while Bun's
`--parallel` mode is limited to the independent top-level test groups.

The gate covers:

- frozen Bun lockfile installation with the pinned Node and Bun toolchain;
- formatting, lint, package-boundary enforcement, workspace type-checking, and
  builds;
- unit, E2E, smoke, and PostgreSQL integration groups as independent parallel jobs, including
  isolated databases, deterministic migration replay, enforced 80% unit coverage, and LCOV upload;
- OpenAPI drift and Drizzle migration-schema drift through `bun run type-check`;
- dependency auditing that does not require production or vendor credentials.

Repository settings allow squash and rebase merges but disable merge commits.
Feature branches must squash into `main`. Release Please version pull requests
must rebase into `main`; Code Foundry fails closed for any other configured
release merge strategy.

## Public-repository security gates

CodeQL and GitHub Dependency Review use Code Foundry's `auto` policy and are
enabled for this public repository. TypeScript and GitHub Actions analysis run
in parallel with Code Foundry's native dependency audit as part of the audit
gate. OpenCode security remains disabled because it is an optional external
integration and is not part of the repository's credential-free baseline.

Maintainers must treat a successful `Validation / Gate` as required and merge
only through a pull request. Repository rules should require that stable gate
without enumerating its internal parallel jobs.

## Foundation acceptance extension

`Foundation Acceptance / Gate` is the repository-specific M1 extension added after the Code Foundry
baseline. Code Foundry remains authoritative for generic formatting, lint, build, test, audit, CodeQL,
and dependency-review behavior. The extension exists only for requirements generic CI cannot infer:
accepted milestone ancestry, all Terraform environment roots, and the shared service/migration
container graph. Its core, Terraform, and container jobs run in parallel and converge on one gate.

## Extension policy

Add repository-owned workflows only when the generic Code Foundry jobs cannot
express a real project requirement. Deeper security scans, image publication,
and deploy or rollback verification are future hooks. They must be
credential-free on pull requests, use isolated resources for parallel jobs,
and become required only after they run reliably on the repository's plan.

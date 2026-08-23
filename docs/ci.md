# Continuous integration

Code Foundry v0.37.2 is the CI control plane for this repository. Its generated
callers are pinned under `.github/workflows/` and target `main` directly; there
is no staging branch.

## Required pull-request gate

`Validation / Gate` is the single stable required check. For an ordinary pull
request it fans out CI, tests, and security as independent parallel jobs, then
aggregates their results. Each workflow cancels superseded work for the same
branch while unrelated pull requests, scheduled audits, and manual runs remain
parallel. Turborepo schedules package work from its dependency graph and uses
its normal worker concurrency; do not bypass that graph with `--parallel`.

The gate covers:

- frozen Bun lockfile installation with the pinned Node and Bun toolchain;
- formatting, lint, package-boundary enforcement, workspace type-checking, and
  builds;
- unit tests and PostgreSQL integration tests, including isolated databases and
  deterministic migration replay;
- OpenAPI drift and Drizzle migration-schema drift through `bun run type-check`;
- dependency auditing that does not require production or vendor credentials.

Repository settings allow squash and rebase merges but disable merge commits.
Feature branches must squash into `main`. Release Please version pull requests
must rebase into `main`; Code Foundry fails closed for any other configured
release merge strategy.

## Private-repository exclusions

CodeQL and GitHub Dependency Review are explicitly disabled because this
private repository does not have the GitHub plan feature required to run them.
OpenCode security is also disabled. These optional jobs must not be configured
as required checks. Code Foundry's native dependency audit remains enabled and
is part of the audit gate.

GitHub branch protection is unavailable on the current private-repository plan.
Until that changes, maintainers must treat a successful `Validation / Gate` as
required and merge only through a pull request.

## Future gates

Add repository-owned workflows only when the generic Code Foundry jobs cannot
express a real project requirement. E2E suites, deeper security scans, image
publication, and deploy or rollback verification are future hooks. They must be
credential-free on pull requests, use isolated resources for parallel jobs,
and become required only after they run reliably on the repository's plan.

# M11 standalone product evidence — 2026-08-30

## Candidate and pinned components

- Candidate: `57a7fe4c9529ba56fbeb183d1ce6567c8800b79a`
- Branch: `feat/m11-standalone-e2e`, based on the accepted M11.2 `staging` candidate
- Bun CLI: `1.4.1` (`bun test` identifies the bundled runner as `1.4.1-canary.1`)
- Node: `v22.23.1`; package engines remain Node `>=24 <25`, so Node is not the
  certifying package runner in this evidence
- Restate: pinned `1.7.7` image/runtime
- Local/Hosted composition: `1.1.0`
- Managed Pi/ACP adapters: `1.2.0`
- Runtime Gateway: `1.2.0`; workflow worker: `1.4.0`
- SQLite persistence: `1.1.0`; PostgreSQL persistence: `1.7.0`

## Credential-free standalone command

`bun run test:m11-standalone` completed successfully from the candidate:

- 41/41 workspace packages built;
- 68 M3–M11 cross-package acceptance tests passed with 407 assertions;
- 17 context-provider tests passed, including no provider, disabled provider, fake
  alternate providers, scope and budget enforcement;
- 7 repository-local Cortana-compatible adapter tests passed without live Cortana;
- 17 encrypted remote-control relay tests passed, including ciphertext-only durable
  storage, replay, key rotation, recipient/AAD binding, and outbound-only polling;
- 9 profile-portability tests passed and the credential-requiring PostgreSQL case was
  explicitly skipped in this credential-free lane;
- 9 deployment tests passed, including process ownership and filesystem checkpoint
  tamper/symlink rejection.

The Local execution slice uses `LocalControlPlaneComposition`, SQLite, filesystem
Artifacts, `DirectLocalRuntimeTransport`, the real managed Pi and ACP adapter/driver
layers, and the shared durable execution lifecycle. Both adapter families reached a
terminal result and survived a composition close/reopen with execution, attempt, and
command state intact. A separate test launched the pinned single-node Restate runtime,
accepted an execution through the public acceptance service, and observed Restate
suspend/replay before the execution completed. No Runtime Gateway process was started
in the Local lane.

## Self-hosted and database checks

The candidate image was built from a clean Docker build and the supported `simple`
Compose profile was started from an empty temporary data directory. `/ready` returned 200. After a forced container recreation, `/ready` returned 200 again and both the API
token file digest and SQLite database digest matched their pre-recreation values. The
isolated Compose stack was then removed without touching unrelated containers.

The PostgreSQL integration suite was also run explicitly with the repository test
roles and an extended hook timeout necessitated by local Docker latency. All 21 tests
and 132 assertions passed, including migrations, execution/attempt lifecycle,
ProjectState, runtime discovery projections, event effects, and restart-safe durable
repositories. The ordinary 30-second integration hook had timed out during database
creation on this host; the passing extended run showed that this was host latency, not
a semantic assertion failure.

A fresh macOS Docker run of the `server` Compose profile did not certify the profile:
PostgreSQL 18 bind-mounted initialization exceeded the Compose health retry window, so
the application never reached a representative execution. The isolated stack was
removed. The supported Linux Compose workflow and live staging deployment remain the
authoritative certification environments.

## Scenario-to-requirement map

| M11.3 scenario                                                                      | Primary executable evidence                                                                                               | Result                                                       |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Local managed Pi and ACP direct transport, Artifacts, usage, cancellation, recovery | `tests/m11-standalone-e2e.test.mjs`, `tests/m6-runtime-adapters.test.mjs`                                                 | Passed                                                       |
| Restate durability, retries, interactions, fan-out/fan-in, budgets, promotion       | `tests/m3-durable-execution.test.mjs`, `tests/m8-multi-agent-orchestration.test.mjs`, `tests/m11-standalone-e2e.test.mjs` | Passed                                                       |
| Tools, models, credentials, policy, sandbox, usage settlement                       | `tests/m7-tools-models-sandboxes.test.mjs`                                                                                | Passed                                                       |
| Runtime Gateway authentication, inventory, delivery, reconnect, redelivery          | `tests/m5-runtime-gateway.test.mjs`                                                                                       | Passed as component E2E; production composition remains open |
| No/disabled/fake/Cortana-compatible context providers                               | `@control-plane/context`, `@control-plane/cortana-context-adapter` package tests                                          | Passed                                                       |
| Encrypted remote-control relay and opaque persistence                               | `@control-plane/remote-control-relay` package tests                                                                       | Passed                                                       |
| Profile semantics and deployment adapters                                           | `tests/m10-portability-conformance.test.mjs`, `@control-plane/deployment` tests                                           | Passed                                                       |
| Local SQLite persistence and restart                                                | `tests/m11-standalone-e2e.test.mjs`, SQLite persistence tests                                                             | Passed                                                       |
| PostgreSQL repository semantics                                                     | `@control-plane/database` integration suite                                                                               | Passed with extended local timeout                           |
| Self-hosted Simple clean start/restart                                              | fresh Compose run described above                                                                                         | Passed on local Docker                                       |
| Self-hosted Server clean start/execution                                            | fresh Compose run described above                                                                                         | Not certified on this host                                   |
| Managed-cloud frozen candidate                                                      | `bun run certify:m9-cloud` against live staging                                                                           | Pending candidate deployment                                 |

## Honest remaining gates

This evidence does not promote fixtures or constructor injection to production proof.
The following gates remain before M11.3 or final M11 approval can be claimed:

1. deploy the frozen candidate to Railway staging and rerun the managed-cloud
   certification against Neon, R2, and Restate;
2. pass the repository-owned Linux `server` Compose path with PostgreSQL and a
   representative execution;
3. replace or explicitly disposition the certification-only/unconfigured remote
   runtime activity ports in cloud and Hosted Server production roots;
4. prove a live inventory producer reaches the durable RuntimeConnection and
   ExternalSession projections through a supported composition;
5. run the PostgreSQL profile migration lane in its supported Linux CI environment;
6. remove the 17 isolated `control_plane_test_*` databases left in the stopped local
   test volume after the destructive-command safety hook blocked their cleanup.

No production environment was modified by these checks.

# M11 deterministic validation evidence — 2026-08-31

## Policy and runtime provenance

- Code Foundry runtime: `v0.40.1` (`523ea1ce213bade87bc2e63f16b1ab90e0a8b6e8`)
- Upstream policy implementation: Code Foundry PR
  [#431](https://github.com/0xPlayerOne/code-foundry/pull/431), merged as
  `0d951230b9095d3b875db44ae8287335152eee60`
- Upstream consumer-config repair: Code Foundry PR
  [#433](https://github.com/0xPlayerOne/code-foundry/pull/433), merged as
  `8d13173a36849528335f87a550072e08137f4473`
- Repository policy: `staging_validation_mode: audit`
- Stable aggregate: `Validation / Gate`
- Default behavior for other Code Foundry consumers remains `fast`; only this
  repository opts staging pull requests into the complete audit graph.

The mode classifier rejects unknown staging policy values. Audit mode requires
CI, the complete Test workflow, Security, and CodeQL to report `success`; a
failed, cancelled, skipped, missing, or unknown required result fails the
aggregate. Release Please pull requests retain their separate release-policy
mode.

## Primary lane inventory

`scripts/run-bun-test-group.mjs` discovers and validates one primary owner for
all 122 tracked Bun test files:

| Public job  | Files | Primary scope                                                        |
| ----------- | ----: | -------------------------------------------------------------------- |
| Unit        |   101 | Isolated colocated application/package logic with coverage           |
| Integration |     4 | PostgreSQL-backed integration boundaries and recovery fixtures       |
| E2E         |    12 | Credential-free M2–M11 cross-package supported-composition scenarios |
| Smoke       |     5 | Repository policy, generated drift, infrastructure, and bootstrap    |

The executable inventory rejects duplicate ownership. The M11 requirement
ledger separately restricts every requirement and prior-milestone audit to one
of the ten accepted validation classes: unit, contract/schema, integration,
end-to-end, smoke/configuration, security/adversarial, eval,
performance/capacity, recovery/chaos, or infrastructure/live-provider
certification.

Existing reusable conformance harnesses cover SDK/OpenAPI compatibility,
PostgreSQL/SQLite persistence, RuntimeAdapter/RuntimeTransport, context
providers, managed Pi/ACP, tools, Artifacts, events, and deployment profiles.
State-machine and race tests exercise execution, interaction, command,
cancellation, and terminal-result conflicts; input-boundary tests cover public
schemas, gateway frames, HPKE envelopes, filesystem paths, and configuration;
fault-seeding covers commit/ACK/provider/runtime/database failures; committed
OpenAPI, ContextBundle, compatibility, architecture, and requirement artifacts
act as golden drift boundaries. Each failure retains its stable M11 requirement
mapping through the machine ledger.

## Determinism and flake policy

- Bun groups randomize order with fixed seed `1104`.
- An explicit seed may be supplied to reproduce a failure.
- `--retry` and `--rerun-each` are rejected. Reruns are diagnostic evidence and
  cannot turn a failed release lane green.
- Normal per-test timeout: 30 seconds. Standalone acceptance timeout: 60 seconds.
- Code Foundry jobs retain independent outer timeouts and runners.
- PostgreSQL, Compose, process, port, and filesystem fixtures own and assert
  cleanup in the lane that creates them.

## Local independent-lane results

All results used Bun `1.4.1-canary.1` from the repository's Bun `1.4.x`
toolchain on macOS Darwin 25.6.0:

| Command              | Result                                      | Runner time |
| -------------------- | ------------------------------------------- | ----------: |
| `bun run test:unit`  | 601 passed; 101 files; coverage gate passed |     11.22 s |
| `bun run test:e2e`   | 89 passed; 12 files                         |     14.56 s |
| `bun run test:smoke` | 45 passed; 5 files                          |     10.44 s |

Unit coverage was 86.54% lines and 82.97% functions against the 80% minimum.
The three credential-free lanes passed in randomized order at seed `1104`.
PostgreSQL integration is intentionally certified in the isolated Linux audit
job rather than reusing the stopped developer-host database volume.

Additional local gates passed:

- Code Foundry `doctor` using the released v0.40.1 source;
- `bun run format:check`;
- `bun run lint`, including 41-package boundary validation;
- `bun run type-check`, including OpenAPI, Drizzle, compatibility,
  requirements, architecture, and Railway IaC checks;
- focused repository, M9 hardening, and requirements-ledger tests: 33 passed,
  310 assertions.

## Scheduled and release-only ownership

Expensive load, capacity, recovery, container, and live-provider certification
remain independently named workflows or explicit commands. They supplement,
but do not duplicate, primary test ownership. Their evidence is immutable and
profile-specific; a scheduled/manual/live skip is never presented as a passing
release certification.

The M9 Production Readiness workflow retains SHA-named load, recovery, and
container-provenance artifacts for 30 days even on failure. The artifacts use a
pinned upload action and fail if the expected evidence file is missing.

## Pull-request proof

The Control Plane pull request and exact audit run are recorded after the
branch executes the new v0.40.1 graph. Acceptance requires Unit, Integration,
E2E, Smoke, Security, CodeQL, and `Validation / Gate` to run without a hidden
required skip.

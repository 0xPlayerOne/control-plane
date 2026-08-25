# Performance, capacity, and cost baseline

The M9 release gate runs `bun run test:load` with the repository-pinned Bun runtime. It
executes 2,000 operations at concurrency 32 for each production-shaped profile:

- control API command reads;
- workflow replay and durable event delivery;
- runtime gateway commands and runtime routing;
- model/tool streaming and multi-agent fan-out;
- an uninstrumented telemetry control and the equivalent instrumented trace path.

Every profile must satisfy all of these budgets:

| Measure                   |                     Release budget |
| ------------------------- | ---------------------------------: |
| p95 latency               |                     at most 100 ms |
| throughput                |   at least 1,000 operations/second |
| error rate                |                                  0 |
| resident-memory increase  |                     at most 64 MiB |
| unit cost                 |            at most $0.02/operation |
| attempts                  | exactly 1 (no retry amplification) |
| telemetry median overhead |                       at most 2 ms |

The harness counts only successful operations toward throughput and fails on invalid cost
or attempt evidence. `BoundedAdmissionController` provides immediate overload rejection
with a retry delay instead of an unbounded in-memory queue. Candidate releases can also be
compared with an explicit prior baseline for latency, throughput, memory, cost, and error-rate
regressions. Invalid or non-finite operation and comparison evidence fails closed instead of being
absorbed by a permitted error budget.

## Measured local baseline

Three consecutive runs passed on 2026-08-25 using Bun 1.3.14, macOS 26.5.2, an Apple M2
Max, and 64 GiB RAM. Across the final run, p95 latency ranged from 0.21 ms to 84.60 ms,
throughput ranged from 2,771 to 398,313 operations/second, memory growth remained below
11 MiB, the error rate was zero, and no operation retried. Instrumentation added 0.15 ms
to the paired median latency. These numbers are a repeatable developer-host regression
baseline, not a substitute for environment-specific production capacity tests.

## Production capacity procedure

1. Run the same gate against the release candidate and its immediate production baseline
   on identical instance classes with production telemetry settings.
2. Ramp concurrency gradually while watching admission rejection, queue depth, database
   saturation, gateway/provider latency, reconciliation backlog, and budget consumption.
3. Stop before provider quotas or cost ceilings are approached. A capacity increase must
   preserve the zero-error and no-retry-amplification budgets.
4. Record the immutable candidate and baseline digests with the evaluation release-gate
   decision. Promote only after every required profile passes; roll back on a material
   regression.
5. Re-establish the baseline after an approved instance, database, provider, or telemetry
   configuration change. Never compare measurements from dissimilar environments.

Application workers reject overload through bounded admission. Infrastructure scaling and
database/provider operating limits are documented in `docs/operations.md`; those limits
remain authoritative when they are lower than a synthetic benchmark result.

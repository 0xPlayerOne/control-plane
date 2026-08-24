# Changelog

## [1.2.0](https://github.com/0xPlayerOne/control-plane/compare/database-v1.1.0...database-v1.2.0) (2026-08-24)


### Features

* **runtime:** ingest health and capability freshness ([#119](https://github.com/0xPlayerOne/control-plane/issues/119)) ([d47445b](https://github.com/0xPlayerOne/control-plane/commit/d47445bbeb0e88e1e65db8cafdff150061b2ca84))
* **runtime:** persist external session references ([#122](https://github.com/0xPlayerOne/control-plane/issues/122)) ([1ef146c](https://github.com/0xPlayerOne/control-plane/commit/1ef146c02b46021b9a13a232ce1b612f608077c7))
* **runtime:** persist runtime connection inventory ([#118](https://github.com/0xPlayerOne/control-plane/issues/118)) ([20fdb11](https://github.com/0xPlayerOne/control-plane/commit/20fdb11db89e75607785734d55057e648c664aac))
* **runtime:** route eligible runtimes deterministically ([#121](https://github.com/0xPlayerOne/control-plane/issues/121)) ([9f7a0fd](https://github.com/0xPlayerOne/control-plane/commit/9f7a0fd74e179dd592d9727ae49bc222b99251d8))


### Bug Fixes

* **test:** stabilize parallel Postgres suites ([#130](https://github.com/0xPlayerOne/control-plane/issues/130)) ([9a0f106](https://github.com/0xPlayerOne/control-plane/commit/9a0f10637c7422e39740c662b70ed0163ef263c6))

## [1.1.0](https://github.com/0xPlayerOne/control-plane/compare/database-v1.0.0...database-v1.1.0) (2026-08-24)


### Features

* **events:** add durable execution event outbox ([#110](https://github.com/0xPlayerOne/control-plane/issues/110)) ([2d6355d](https://github.com/0xPlayerOne/control-plane/commit/2d6355d4a9b82b38ae2c3ba40055eab78a7401f8)), closes [#22](https://github.com/0xPlayerOne/control-plane/issues/22)
* **events:** deliver execution events to Agent HQ ([#113](https://github.com/0xPlayerOne/control-plane/issues/113)) ([641ac7a](https://github.com/0xPlayerOne/control-plane/commit/641ac7aef9bcb05a6fbfc0d5c732dce0233b0b55))
* **execution:** add durable execution lifecycle ([#105](https://github.com/0xPlayerOne/control-plane/issues/105)) ([4429d4d](https://github.com/0xPlayerOne/control-plane/commit/4429d4da040e785ef566db8136d5b21c42ac30d7)), closes [#20](https://github.com/0xPlayerOne/control-plane/issues/20)
* **execution:** add durable interaction lifecycle ([#112](https://github.com/0xPlayerOne/control-plane/issues/112)) ([83a3bb6](https://github.com/0xPlayerOne/control-plane/commit/83a3bb6fcec8969bcb78dfa4bbbc167a5fe767c0))
* **execution:** add idempotent command acceptance ([#109](https://github.com/0xPlayerOne/control-plane/issues/109)) ([bd096fb](https://github.com/0xPlayerOne/control-plane/commit/bd096fb54f49110654a3853a268179a69f60e5c2)), closes [#21](https://github.com/0xPlayerOne/control-plane/issues/21)
* **reliability:** reconcile unknown execution outcomes ([#114](https://github.com/0xPlayerOne/control-plane/issues/114)) ([2cbd07b](https://github.com/0xPlayerOne/control-plane/commit/2cbd07b8747925560a90fa3eaad057d0ffbdf4ee))

## 1.0.0 (2026-08-24)


### Features

* add PostgreSQL persistence foundation ([2fdfd88](https://github.com/0xPlayerOne/control-plane/commit/2fdfd8856ab7b1d4d7e592e1d998a0e8314f11b9)), closes [#3](https://github.com/0xPlayerOne/control-plane/issues/3)
* bootstrap the platform monorepo ([3a745cd](https://github.com/0xPlayerOne/control-plane/commit/3a745cdf3cdaee9c57677039acdb057e3c528f3d))

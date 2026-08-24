# Changelog

## [1.1.0](https://github.com/0xPlayerOne/control-plane/compare/workspace-v1.0.0...workspace-v1.1.0) (2026-08-24)


### Features

* **events:** add durable execution event outbox ([#110](https://github.com/0xPlayerOne/control-plane/issues/110)) ([2d6355d](https://github.com/0xPlayerOne/control-plane/commit/2d6355d4a9b82b38ae2c3ba40055eab78a7401f8)), closes [#22](https://github.com/0xPlayerOne/control-plane/issues/22)
* **events:** deliver execution events to Agent HQ ([#113](https://github.com/0xPlayerOne/control-plane/issues/113)) ([641ac7a](https://github.com/0xPlayerOne/control-plane/commit/641ac7aef9bcb05a6fbfc0d5c732dce0233b0b55))
* **execution:** add durable execution lifecycle ([#105](https://github.com/0xPlayerOne/control-plane/issues/105)) ([4429d4d](https://github.com/0xPlayerOne/control-plane/commit/4429d4da040e785ef566db8136d5b21c42ac30d7)), closes [#20](https://github.com/0xPlayerOne/control-plane/issues/20)
* **execution:** add durable interaction lifecycle ([#112](https://github.com/0xPlayerOne/control-plane/issues/112)) ([83a3bb6](https://github.com/0xPlayerOne/control-plane/commit/83a3bb6fcec8969bcb78dfa4bbbc167a5fe767c0))
* **execution:** add idempotent command acceptance ([#109](https://github.com/0xPlayerOne/control-plane/issues/109)) ([bd096fb](https://github.com/0xPlayerOne/control-plane/commit/bd096fb54f49110654a3853a268179a69f60e5c2)), closes [#21](https://github.com/0xPlayerOne/control-plane/issues/21)
* **reliability:** reconcile unknown execution outcomes ([#114](https://github.com/0xPlayerOne/control-plane/issues/114)) ([2cbd07b](https://github.com/0xPlayerOne/control-plane/commit/2cbd07b8747925560a90fa3eaad057d0ffbdf4ee))
* **workflows:** add Temporal execution lifecycle ([#111](https://github.com/0xPlayerOne/control-plane/issues/111)) ([f70ad1e](https://github.com/0xPlayerOne/control-plane/commit/f70ad1e06c5c87fb349909188ca01cfc4c212aef)), closes [#23](https://github.com/0xPlayerOne/control-plane/issues/23)


### Tests

* **acceptance:** prove durable execution recovery ([#115](https://github.com/0xPlayerOne/control-plane/issues/115)) ([2201902](https://github.com/0xPlayerOne/control-plane/commit/2201902b6a3fdc085462f8481ae473a88454ef6c))


### Maintenance

* **github:** apply live label metadata once ([#107](https://github.com/0xPlayerOne/control-plane/issues/107)) ([3f1a2ad](https://github.com/0xPlayerOne/control-plane/commit/3f1a2ad948450ba7614ad08b757ad023cf996fd4))
* **github:** remove one-time label workflow ([#108](https://github.com/0xPlayerOne/control-plane/issues/108)) ([6e5937b](https://github.com/0xPlayerOne/control-plane/commit/6e5937b2c5e6fd7c557876b2832cf02c2fcd043d))

## 1.0.0 (2026-08-24)


### Features

* add immutable AgentProfile and Skill versions ([#90](https://github.com/0xPlayerOne/control-plane/issues/90)) ([f09d6fd](https://github.com/0xPlayerOne/control-plane/commit/f09d6fded7abad1429b805d7c1248bf4627ca8ae))
* add PostgreSQL persistence foundation ([2fdfd88](https://github.com/0xPlayerOne/control-plane/commit/2fdfd8856ab7b1d4d7e592e1d998a0e8314f11b9)), closes [#3](https://github.com/0xPlayerOne/control-plane/issues/3)
* add revisioned project state ([#93](https://github.com/0xPlayerOne/control-plane/issues/93)) ([4f3e7ac](https://github.com/0xPlayerOne/control-plane/commit/4f3e7ac04b18eed869fbc3d02f8506b676014e62))
* add service configuration bootstrap ([3d7364a](https://github.com/0xPlayerOne/control-plane/commit/3d7364ac54a68744f8a46407861489014bb8e2a3))
* add telemetry foundation ([#80](https://github.com/0xPlayerOne/control-plane/issues/80)) ([6ca188e](https://github.com/0xPlayerOne/control-plane/commit/6ca188e1f26cd32cfd05dea005e067f8eff27938))
* bootstrap the platform monorepo ([3a745cd](https://github.com/0xPlayerOne/control-plane/commit/3a745cdf3cdaee9c57677039acdb057e3c528f3d))
* compile immutable execution plans ([#95](https://github.com/0xPlayerOne/control-plane/issues/95)) ([88346ef](https://github.com/0xPlayerOne/control-plane/commit/88346efea272bb1ab9441f14a3114869d8e9340b))
* compile reproducible context packages ([#94](https://github.com/0xPlayerOne/control-plane/issues/94)) ([488f5c5](https://github.com/0xPlayerOne/control-plane/commit/488f5c5556fc0a59f7793c01e1be3c3f3ae679d2))
* **contracts:** define Agent HQ service boundary ([#88](https://github.com/0xPlayerOne/control-plane/issues/88)) ([e18468a](https://github.com/0xPlayerOne/control-plane/commit/e18468af35141207971df1b6cd9a8490077da710))
* define execution constraint contracts ([#92](https://github.com/0xPlayerOne/control-plane/issues/92)) ([6945676](https://github.com/0xPlayerOne/control-plane/commit/694567609c5b6b9123622446e528c5298d34e4ad))
* define runtime capability compatibility model ([#91](https://github.com/0xPlayerOne/control-plane/issues/91)) ([6fa2a77](https://github.com/0xPlayerOne/control-plane/commit/6fa2a777692aae1277a5823cb7f52bf56c7df973))
* enforce Agent HQ service authentication ([#89](https://github.com/0xPlayerOne/control-plane/issues/89)) ([09c0554](https://github.com/0xPlayerOne/control-plane/commit/09c0554f832e4bb40229ed0366274ea2b78721fe))
* **foundation:** add M1 acceptance baseline ([#87](https://github.com/0xPlayerOne/control-plane/issues/87)) ([bba3f0e](https://github.com/0xPlayerOne/control-plane/commit/bba3f0eea1fb77a20c51e468d34bf629a67fdfe2))
* **infra:** define deployment and infrastructure baseline ([#85](https://github.com/0xPlayerOne/control-plane/issues/85)) ([813a309](https://github.com/0xPlayerOne/control-plane/commit/813a309de78e269dfccc2d592934c1a3139d564e))
* publish typed Control Plane SDK and contract harness ([#97](https://github.com/0xPlayerOne/control-plane/issues/97)) ([5bcea7c](https://github.com/0xPlayerOne/control-plane/commit/5bcea7c729b8dc79b58dd3bb713251b61adffade))
* scaffold NestJS Fastify Control API ([e99cdde](https://github.com/0xPlayerOne/control-plane/commit/e99cdded89f5c3dad6d6ff0b6d45c06a8b2bee73)), closes [#4](https://github.com/0xPlayerOne/control-plane/issues/4)


### Bug Fixes

* **release:** track every workspace ([#104](https://github.com/0xPlayerOne/control-plane/issues/104)) ([85f2b6d](https://github.com/0xPlayerOne/control-plane/commit/85f2b6dc1d356024d809807c264ed910cb487efc))
* **release:** validate coordinated package versions ([#98](https://github.com/0xPlayerOne/control-plane/issues/98)) ([7771a6f](https://github.com/0xPlayerOne/control-plane/commit/7771a6ff2f577ca2eb1b4de957bea7fed9b31ec0))
* scope bare `bun test` to the repository test root ([3d66f77](https://github.com/0xPlayerOne/control-plane/commit/3d66f77d7ca58d6037e07e43d14317725ada0510))
* **sdk:** accept release-managed package versions ([#99](https://github.com/0xPlayerOne/control-plane/issues/99)) ([27f86e3](https://github.com/0xPlayerOne/control-plane/commit/27f86e3643683eec626f3a337c76dd7061d94055))


### Documentation

* add runtime compatibility data and architecture sources ([#86](https://github.com/0xPlayerOne/control-plane/issues/86)) ([7b88459](https://github.com/0xPlayerOne/control-plane/commit/7b884597ef79c0ed55283c05a9c88e060da886e5))


### Tests

* add shared foundation harness ([#79](https://github.com/0xPlayerOne/control-plane/issues/79)) ([96053ed](https://github.com/0xPlayerOne/control-plane/commit/96053ed7e9a38a3f391168b12906a7165f335fb3))
* prove M2 core-domain acceptance ([#103](https://github.com/0xPlayerOne/control-plane/issues/103)) ([eada793](https://github.com/0xPlayerOne/control-plane/commit/eada793f49e91ba4179e126b592bcb40b77ee88b)), closes [#19](https://github.com/0xPlayerOne/control-plane/issues/19)


### CI

* establish Code Foundry quality gates ([#81](https://github.com/0xPlayerOne/control-plane/issues/81)) ([5d34dc1](https://github.com/0xPlayerOne/control-plane/commit/5d34dc1fad081ba9c437343fff175e87b86faac6))
* restore public repository security gates ([#83](https://github.com/0xPlayerOne/control-plane/issues/83)) ([a8102ea](https://github.com/0xPlayerOne/control-plane/commit/a8102ea30efd3d6336eb1fd815789103033aac5a))
* upgrade Code Foundry to v0.37.4 ([#96](https://github.com/0xPlayerOne/control-plane/issues/96)) ([0d656e3](https://github.com/0xPlayerOne/control-plane/commit/0d656e3ec9d8922a347c2a2b70399bae8332d24d))
* upgrade Code Foundry to v0.37.5 ([#100](https://github.com/0xPlayerOne/control-plane/issues/100)) ([f9a1d99](https://github.com/0xPlayerOne/control-plane/commit/f9a1d990688c544ba393f9f237906ea03ab2e472))


### Maintenance

* **deps:** apply compatible npm dependency updates ([#102](https://github.com/0xPlayerOne/control-plane/issues/102)) ([eaf3e48](https://github.com/0xPlayerOne/control-plane/commit/eaf3e48f5fe6c85c79e6d83874df8af24f079f5c))
* **deps:** bump actions/setup-node from 5.0.0 to 7.0.0 in the github-actions group ([#101](https://github.com/0xPlayerOne/control-plane/issues/101)) ([a7d6c9d](https://github.com/0xPlayerOne/control-plane/commit/a7d6c9d7f05ec596a6c2c058f377f149a4c51df4))
* **deps:** bump actions/setup-node in the github-actions group ([a7d6c9d](https://github.com/0xPlayerOne/control-plane/commit/a7d6c9d7f05ec596a6c2c058f377f149a4c51df4))
* install repo-local agent skills and ignore other harness dirs ([4f51dfb](https://github.com/0xPlayerOne/control-plane/commit/4f51dfbdca2113b439d4bb977e14695251220e99))
* migrate skills to .agents/skills/ for team sharing ([#78](https://github.com/0xPlayerOne/control-plane/issues/78)) ([4c8906f](https://github.com/0xPlayerOne/control-plane/commit/4c8906f337e2ae44f9898df04b16289d642c6954))
* split AGENTS.md into progressive disclosure structure ([90917d6](https://github.com/0xPlayerOne/control-plane/commit/90917d61700c30e58198286a585aba6d2d94a199))

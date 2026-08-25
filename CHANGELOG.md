# Changelog

## [1.3.1](https://github.com/0xPlayerOne/control-plane/compare/workspace-v1.3.0...workspace-v1.3.1) (2026-08-25)


### Bug Fixes

* **gateway:** reject frames after channel revocation ([#147](https://github.com/0xPlayerOne/control-plane/issues/147)) ([1c9ce81](https://github.com/0xPlayerOne/control-plane/commit/1c9ce8155313196e47f3925fbdcda622475cf026))
* **runtime-gateway:** fail closed without production server ([#154](https://github.com/0xPlayerOne/control-plane/issues/154)) ([e6309d7](https://github.com/0xPlayerOne/control-plane/commit/e6309d76a262fae79ee388aebdb22632dd7fdbe6))
* **runtime-gateway:** reject privileged selector aliases ([#149](https://github.com/0xPlayerOne/control-plane/issues/149)) ([cb524e5](https://github.com/0xPlayerOne/control-plane/commit/cb524e5870798da8de0bd89cd95a3ae89cb59a23))
* **runtime-gateway:** require explicit reconnect recovery ([#150](https://github.com/0xPlayerOne/control-plane/issues/150)) ([1072dd9](https://github.com/0xPlayerOne/control-plane/commit/1072dd9f991d5d9693e7d4475cc9471cf0e42136))


### CI

* **code-foundry:** adopt reversible billing guards ([#152](https://github.com/0xPlayerOne/control-plane/issues/152)) ([1eccc21](https://github.com/0xPlayerOne/control-plane/commit/1eccc219b3c03eb12e10a73ff18c65100adc9019))


### Maintenance

* **runtime-gateway:** unify event context types ([#153](https://github.com/0xPlayerOne/control-plane/issues/153)) ([a012e71](https://github.com/0xPlayerOne/control-plane/commit/a012e7156c88354156745dc6fcdb983091c33346))
* **typescript:** strengthen compiler checks ([#151](https://github.com/0xPlayerOne/control-plane/issues/151)) ([b58dfba](https://github.com/0xPlayerOne/control-plane/commit/b58dfba7d2aa6f4eaf783d89cb8899eb6cffc636))

## [1.3.0](https://github.com/0xPlayerOne/control-plane/compare/workspace-v1.2.1...workspace-v1.3.0) (2026-08-25)


### Features

* **gateway:** authenticate runtime node channels ([#137](https://github.com/0xPlayerOne/control-plane/issues/137)) ([ddb04b8](https://github.com/0xPlayerOne/control-plane/commit/ddb04b883ddcfaf84fe3b2521118113c267b55aa))
* **gateway:** define runtime node protocol ([#135](https://github.com/0xPlayerOne/control-plane/issues/135)) ([13a008a](https://github.com/0xPlayerOne/control-plane/commit/13a008a6e18e8c1916cf1be1e82a3032c6ac7f6f))
* **gateway:** ingest normalized runtime events ([#140](https://github.com/0xPlayerOne/control-plane/issues/140)) ([7542146](https://github.com/0xPlayerOne/control-plane/commit/7542146f8f84fc72061c17d4fc4bc7ec435ddc76))
* **gateway:** manage scalable websocket channels ([#138](https://github.com/0xPlayerOne/control-plane/issues/138)) ([02a5d48](https://github.com/0xPlayerOne/control-plane/commit/02a5d48b7982097448dddda79d07a3bc6e799e89))
* **gateway:** persist runtime command delivery ([#139](https://github.com/0xPlayerOne/control-plane/issues/139)) ([1874f27](https://github.com/0xPlayerOne/control-plane/commit/1874f27edbd925b7ba5f9f74d26cc53719758f8b))
* **gateway:** reconcile reconnect command state ([#142](https://github.com/0xPlayerOne/control-plane/issues/142)) ([3f897aa](https://github.com/0xPlayerOne/control-plane/commit/3f897aa0b72c5b5e1930342aab7079bf8a12dbae))
* **gateway:** synchronize runtime inventory health ([#141](https://github.com/0xPlayerOne/control-plane/issues/141)) ([656b580](https://github.com/0xPlayerOne/control-plane/commit/656b580e58986b460b10d109cdeed78ba620307f))


### Bug Fixes

* **test:** honor integration timeout budget ([#144](https://github.com/0xPlayerOne/control-plane/issues/144)) ([7b8cd53](https://github.com/0xPlayerOne/control-plane/commit/7b8cd5322149fea79a9c12bd41c8f596576faac9))
* **test:** serialize integration projects ([#146](https://github.com/0xPlayerOne/control-plane/issues/146)) ([b5028c1](https://github.com/0xPlayerOne/control-plane/commit/b5028c107d1e026c98b688c4524abbe9ccbc0d87))


### Documentation

* **test:** document M1-M5 acceptance ([#145](https://github.com/0xPlayerOne/control-plane/issues/145)) ([c43b3bb](https://github.com/0xPlayerOne/control-plane/commit/c43b3bb9334209c81aa911646f589c0d3a2dada4))


### Tests

* **runtime-gateway:** add M5 acceptance suite ([#143](https://github.com/0xPlayerOne/control-plane/issues/143)) ([1784dfc](https://github.com/0xPlayerOne/control-plane/commit/1784dfc6a4339d0292dc438be23ec5cedd86a76e))

## [1.2.1](https://github.com/0xPlayerOne/control-plane/compare/workspace-v1.2.0...workspace-v1.2.1) (2026-08-24)


### Bug Fixes

* **api:** wire runtime discovery at startup ([#134](https://github.com/0xPlayerOne/control-plane/issues/134)) ([997cb29](https://github.com/0xPlayerOne/control-plane/commit/997cb297add20461a6fa90852da935783192fbeb))
* **runtime:** report expired session discovery snapshots ([#133](https://github.com/0xPlayerOne/control-plane/issues/133)) ([cd8834f](https://github.com/0xPlayerOne/control-plane/commit/cd8834fbe98ae5deef501f05e2d9b3c669df1e9b))
* **runtime:** require negotiated capability verification ([#131](https://github.com/0xPlayerOne/control-plane/issues/131)) ([af0423f](https://github.com/0xPlayerOne/control-plane/commit/af0423f87810e7dd9bc0a11fa00836e3fbce9575))

## [1.2.0](https://github.com/0xPlayerOne/control-plane/compare/workspace-v1.1.0...workspace-v1.2.0) (2026-08-24)


### Features

* **runtime:** define adapter contract and conformance harness ([#116](https://github.com/0xPlayerOne/control-plane/issues/116)) ([434f688](https://github.com/0xPlayerOne/control-plane/commit/434f6888c9c886c39eab6bb057d0285ecc56f7bd))
* **runtime:** evaluate runtime eligibility deterministically ([#120](https://github.com/0xPlayerOne/control-plane/issues/120)) ([840b9b5](https://github.com/0xPlayerOne/control-plane/commit/840b9b58ea400be3d41388218cc2adbad20202a8))
* **runtime:** expose Agent HQ discovery models ([#123](https://github.com/0xPlayerOne/control-plane/issues/123)) ([cf43141](https://github.com/0xPlayerOne/control-plane/commit/cf43141f18d82fb3bd5466e47f1df8606b1d1fa1))
* **runtime:** ingest health and capability freshness ([#119](https://github.com/0xPlayerOne/control-plane/issues/119)) ([d47445b](https://github.com/0xPlayerOne/control-plane/commit/d47445bbeb0e88e1e65db8cafdff150061b2ca84))
* **runtime:** persist external session references ([#122](https://github.com/0xPlayerOne/control-plane/issues/122)) ([1ef146c](https://github.com/0xPlayerOne/control-plane/commit/1ef146c02b46021b9a13a232ce1b612f608077c7))
* **runtime:** persist runtime connection inventory ([#118](https://github.com/0xPlayerOne/control-plane/issues/118)) ([20fdb11](https://github.com/0xPlayerOne/control-plane/commit/20fdb11db89e75607785734d55057e648c664aac))
* **runtime:** route eligible runtimes deterministically ([#121](https://github.com/0xPlayerOne/control-plane/issues/121)) ([9f7a0fd](https://github.com/0xPlayerOne/control-plane/commit/9f7a0fd74e179dd592d9727ae49bc222b99251d8))


### Bug Fixes

* **test:** stabilize parallel Postgres suites ([#130](https://github.com/0xPlayerOne/control-plane/issues/130)) ([9a0f106](https://github.com/0xPlayerOne/control-plane/commit/9a0f10637c7422e39740c662b70ed0163ef263c6))


### Tests

* **ci:** parallelize Code Foundry suites ([#129](https://github.com/0xPlayerOne/control-plane/issues/129)) ([9836a52](https://github.com/0xPlayerOne/control-plane/commit/9836a5200ce905bb5774bbc7edf7b1ab322d4b90))
* **runtime:** cover runtime fabric acceptance ([#124](https://github.com/0xPlayerOne/control-plane/issues/124)) ([accf185](https://github.com/0xPlayerOne/control-plane/commit/accf185640c1e1e393bc07eb9c9af782e5e221fa))

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

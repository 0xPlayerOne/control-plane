import { describe, expect, test } from 'bun:test'
import {
  EvaluationService,
  InMemoryEvaluationRepository,
  ReleaseGateRegistry,
} from './index.ts'

const configuration = {
  executionPlanDigest: `sha256:${'1'.repeat(64)}`,
  profile: { id: 'profile-research', version: '4.2.0', digest: `sha256:${'2'.repeat(64)}` },
  skills: [
    { id: 'skill-search', version: '3.1.0', digest: `sha256:${'3'.repeat(64)}` },
  ],
  graph: { id: 'graph-research', version: '2.0.0', digest: `sha256:${'4'.repeat(64)}` },
  runtime: {
    id: 'runtime-managed-pi',
    version: '1.8.0',
    digest: `sha256:${'5'.repeat(64)}`,
  },
  model: {
    id: 'reasoning-standard',
    version: '2026-08-01',
    digest: `sha256:${'6'.repeat(64)}`,
  },
  tools: [{ id: 'tool-search', version: '2.4.0', digest: `sha256:${'7'.repeat(64)}` }],
  policy: { id: 'policy-default', version: '5.0.0', digest: `sha256:${'8'.repeat(64)}` },
}

const suite = {
  evalSuiteId: 'eval-suite-release',
  version: '1.0.0',
  digest: `sha256:${'9'.repeat(64)}`,
  dataset: {
    id: 'dataset-release',
    version: '2026-08-25',
    digest: `sha256:${'a'.repeat(64)}`,
  },
  mode: 'offline',
  cases: [
    {
      evalCaseId: 'case-correctness',
      inputDigest: `sha256:${'b'.repeat(64)}`,
      scorers: [
        { metric: 'functional_correctness', direction: 'min', threshold: 0.95, required: true },
        { metric: 'latency_ms', direction: 'max', threshold: 500, required: true },
        { metric: 'cost_usd', direction: 'max', threshold: 0.05, required: true },
      ],
    },
  ],
}

describe('production evaluation and release gates', () => {
  test('records exact immutable configuration for every deterministic result', async () => {
    const repository = new InMemoryEvaluationRepository()
    const service = new EvaluationService({ repository, now: () => '2026-08-25T12:00:00.000Z' })

    const run = await service.run({
      evalRunId: 'eval-run-candidate',
      suite,
      configuration,
      execute: async () => ({ functional_correctness: 1, latency_ms: 120, cost_usd: 0.02 }),
    })

    expect(run.status).toBe('passed')
    expect(run.results[0].configuration).toEqual(configuration)
    expect(run.results[0].dataset).toEqual(suite.dataset)
    expect(await repository.getRun('eval-run-candidate')).toEqual(run)
  })

  test('blocks a required regression without deleting the candidate', async () => {
    const repository = new InMemoryEvaluationRepository()
    const service = new EvaluationService({ repository, now: () => '2026-08-25T12:00:00.000Z' })
    const baseline = await service.run({
      evalRunId: 'eval-run-baseline',
      suite,
      configuration,
      execute: async () => ({ functional_correctness: 1, latency_ms: 100, cost_usd: 0.01 }),
    })
    const candidate = await service.run({
      evalRunId: 'eval-run-candidate',
      suite,
      configuration: {
        ...configuration,
        profile: {
          ...configuration.profile,
          version: '4.3.0',
          digest: `sha256:${'c'.repeat(64)}`,
        },
      },
      execute: async () => ({ functional_correctness: 0.9, latency_ms: 180, cost_usd: 0.03 }),
    })
    const registry = new ReleaseGateRegistry({ now: () => '2026-08-25T12:01:00.000Z' })

    const decision = registry.evaluate({
      releaseGateId: 'gate-profile-default',
      candidate,
      baseline,
      maximumRegressions: { functional_correctness: 0.02, latency_ms: 0.25, cost_usd: 0.5 },
    })

    expect(decision.status).toBe('blocked')
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        'REQUIRED_THRESHOLD_FAILED:functional_correctness',
        'REGRESSION:functional_correctness',
        'REGRESSION:latency_ms',
        'REGRESSION:cost_usd',
      ])
    )
    expect(registry.candidate('gate-profile-default')).toEqual(candidate)
    expect(() => registry.promote('gate-profile-default', 'operator://release')).toThrow(
      'RELEASE_GATE_BLOCKED'
    )
  })

  test('requires explicit promotion and records explicit rollback', async () => {
    const repository = new InMemoryEvaluationRepository()
    const service = new EvaluationService({ repository, now: () => '2026-08-25T12:00:00.000Z' })
    const baseline = await service.run({
      evalRunId: 'eval-run-baseline',
      suite,
      configuration,
      execute: async () => ({ functional_correctness: 0.96, latency_ms: 200, cost_usd: 0.03 }),
    })
    const candidate = await service.run({
      evalRunId: 'eval-run-candidate',
      suite,
      configuration,
      execute: async () => ({ functional_correctness: 0.99, latency_ms: 180, cost_usd: 0.02 }),
    })
    const registry = new ReleaseGateRegistry({ now: () => '2026-08-25T12:01:00.000Z' })
    expect(
      registry.evaluate({
        releaseGateId: 'gate-profile-default',
        candidate,
        baseline,
        maximumRegressions: { functional_correctness: 0.02, latency_ms: 0.25, cost_usd: 0.5 },
      }).status
    ).toBe('passed')
    expect(registry.promoted('gate-profile-default')).toBeUndefined()

    const promotion = registry.promote('gate-profile-default', 'operator://release')
    const rollback = registry.rollback('gate-profile-default', 'operator://incident', 'latency')

    expect(promotion.action).toBe('promote')
    expect(rollback.action).toBe('rollback')
    expect(registry.auditLog()).toEqual([promotion, rollback])
    expect(registry.promoted('gate-profile-default')).toEqual(baseline)
  })

  test('fails closed when a live-provider suite is not explicitly enabled', async () => {
    const service = new EvaluationService({ repository: new InMemoryEvaluationRepository() })
    await expect(
      service.run({
        evalRunId: 'eval-run-live',
        suite: { ...suite, mode: 'live_provider' },
        configuration,
        execute: async () => ({ functional_correctness: 1, latency_ms: 100, cost_usd: 0.01 }),
      })
    ).rejects.toThrow('LIVE_EVALUATION_NOT_AUTHORIZED')
  })
})

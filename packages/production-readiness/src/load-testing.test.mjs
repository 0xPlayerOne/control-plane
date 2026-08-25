import { describe, expect, test } from 'bun:test'
import { BoundedAdmissionController, compareLoadBaselines, runLoadProfile } from './index.ts'

describe('load, capacity, and cost baselines', () => {
  test('measures latency, throughput, errors, memory, attempts, and unit cost', async () => {
    let timestamp = 0
    const result = await runLoadProfile(
      {
        profileId: 'api-command-baseline',
        iterations: 4,
        concurrency: 2,
        budgets: {
          p95LatencyMs: 10,
          minimumThroughputPerSecond: 100,
          maximumErrorRate: 0,
          maximumMemoryDeltaBytes: 1024,
          maximumCostPerOperationUsd: 0.01,
          maximumAttemptsPerOperation: 1,
        },
      },
      async ({ sequence }) => ({ costUsd: sequence * 0.001, attempts: 1 }),
      {
        now: () => (timestamp += 1),
        memoryUsage: (() => {
          const values = [1000, 1200]
          return () => values.shift() ?? 1200
        })(),
      }
    )

    expect(result).toMatchObject({
      profileId: 'api-command-baseline',
      completed: 4,
      failed: 0,
      p95LatencyMs: 3,
      errorRate: 0,
      memoryDeltaBytes: 200,
      maximumAttempts: 1,
      status: 'passed',
    })
    expect(result.throughputPerSecond).toBeCloseTo(444.444, 3)
    expect(result.costPerOperationUsd).toBe(0.0015)
  })

  test('rejects excess work immediately without an unbounded queue', async () => {
    const admission = new BoundedAdmissionController({ maximumInFlight: 1, retryAfterMs: 250 })
    let release
    const active = admission.tryRun(() => new Promise((resolve) => (release = resolve)))
    const rejected = await admission.tryRun(async () => 'unexpected')

    expect(rejected).toEqual({ accepted: false, retryAfterMs: 250 })
    expect(admission.inFlight).toBe(1)
    release('completed')
    await expect(active).resolves.toEqual({ accepted: true, value: 'completed' })
    expect(admission.inFlight).toBe(0)
  })

  test('fails budgets for latency, errors, cost amplification, and retry amplification', async () => {
    let timestamp = 0
    const result = await runLoadProfile(
      {
        profileId: 'provider-degradation',
        iterations: 2,
        concurrency: 1,
        budgets: {
          p95LatencyMs: 1,
          minimumThroughputPerSecond: 1000,
          maximumErrorRate: 0,
          maximumMemoryDeltaBytes: 0,
          maximumCostPerOperationUsd: 0.01,
          maximumAttemptsPerOperation: 1,
        },
      },
      async ({ sequence }) => {
        if (sequence === 1) throw new Error('PROVIDER_UNAVAILABLE')
        return { costUsd: 0.03, attempts: 3 }
      },
      { now: () => (timestamp += 5), memoryUsage: () => 1000 }
    )

    expect(result.status).toBe('failed')
    expect(result.failedBudgets).toEqual(
      expect.arrayContaining([
        'p95_latency',
        'throughput',
        'error_rate',
        'unit_cost',
        'attempt_amplification',
      ])
    )
  })

  test('compares release baselines using explicit material-regression budgets', () => {
    const baseline = {
      p95LatencyMs: 100,
      throughputPerSecond: 1000,
      costPerOperationUsd: 0.01,
      memoryDeltaBytes: 1000,
      errorRate: 0,
    }
    expect(
      compareLoadBaselines({
        baseline,
        candidate: {
          ...baseline,
          p95LatencyMs: 130,
          throughputPerSecond: 750,
          costPerOperationUsd: 0.013,
          errorRate: 0.01,
        },
        maximumRegressions: {
          latency: 0.2,
          throughput: 0.2,
          cost: 0.2,
          memory: 0.2,
          errorRate: 0,
        },
      })
    ).toEqual(['cost', 'error_rate', 'latency', 'throughput'])
  })

  test('fails closed on invalid accounting evidence even when errors are budgeted', async () => {
    const result = await runLoadProfile(
      {
        profileId: 'invalid-accounting',
        iterations: 1,
        concurrency: 1,
        budgets: {
          p95LatencyMs: 100,
          minimumThroughputPerSecond: 0,
          maximumErrorRate: 1,
          maximumMemoryDeltaBytes: 1024,
          maximumCostPerOperationUsd: 1,
          maximumAttemptsPerOperation: 2,
        },
      },
      async () => ({ costUsd: Number.NaN, attempts: 1 }),
      { now: () => 1, memoryUsage: () => 1000 }
    )

    expect(result).toMatchObject({ status: 'failed', invalidEvidence: 1 })
    expect(result.failedBudgets).toContain('invalid_evidence')
  })

  test('fails closed on invalid clock or memory measurements', async () => {
    const result = await runLoadProfile(
      {
        profileId: 'invalid-measurements',
        iterations: 1,
        concurrency: 1,
        budgets: {
          p95LatencyMs: 100,
          minimumThroughputPerSecond: 0,
          maximumErrorRate: 1,
          maximumMemoryDeltaBytes: 1024,
          maximumCostPerOperationUsd: 1,
          maximumAttemptsPerOperation: 2,
        },
      },
      async () => ({ costUsd: 0, attempts: 1 }),
      { now: () => Number.NaN, memoryUsage: () => Number.POSITIVE_INFINITY }
    )

    expect(result.status).toBe('failed')
    expect(result.failedBudgets).toContain('invalid_evidence')
  })

  test('rejects non-finite or negative baseline comparison inputs', () => {
    const baseline = {
      p95LatencyMs: 100,
      throughputPerSecond: 1000,
      costPerOperationUsd: 0.01,
      memoryDeltaBytes: 1000,
      errorRate: 0,
    }
    expect(() =>
      compareLoadBaselines({
        baseline,
        candidate: { ...baseline, p95LatencyMs: Number.NaN },
        maximumRegressions: {
          latency: 0.2,
          throughput: 0.2,
          cost: 0.2,
          memory: 0.2,
          errorRate: 0,
        },
      })
    ).toThrow('INVALID_LOAD_BASELINE')
  })
})

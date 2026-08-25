import { describe, expect, test } from 'bun:test'
import { assessDeployment } from './index.ts'

const current = {
  releaseId: 'release-100',
  commitSha: 'a'.repeat(40),
  images: { 'control-api': `registry/control-api@sha256:${'1'.repeat(64)}` },
  contracts: { api: 1, database: 18, runtimeGateway: 1 },
}

describe('production deployment compatibility gate', () => {
  test('permits a verified backward-compatible migration and healthy canary', () => {
    const result = assessDeployment({
      current,
      candidate: {
        ...current,
        releaseId: 'release-101',
        commitSha: 'b'.repeat(40),
        images: { 'control-api': `registry/control-api@sha256:${'2'.repeat(64)}` },
        contracts: { ...current.contracts, database: 19 },
      },
      compatibility: { api: [1], database: [18, 19], runtimeGateway: [1] },
      migration: { from: 18, to: 19, applied: true, rollbackRestoreVerified: true },
      canary: { healthy: true, errorRate: 0, p95LatencyMs: 90 },
      budgets: { maximumErrorRate: 0, maximumP95LatencyMs: 100 },
    })

    expect(result).toEqual({ decision: 'promote', reasons: [] })
  })

  test('blocks unsupported contracts, mutable images, and skipped migrations', () => {
    const result = assessDeployment({
      current,
      candidate: {
        releaseId: 'release-unsafe',
        commitSha: 'c'.repeat(40),
        images: { 'control-api': 'registry/control-api:latest' },
        contracts: { api: 2, database: 20, runtimeGateway: 1 },
      },
      compatibility: { api: [1], database: [18, 19], runtimeGateway: [1] },
      canary: { healthy: false, errorRate: 0.1, p95LatencyMs: 500 },
      budgets: { maximumErrorRate: 0, maximumP95LatencyMs: 100 },
    })

    expect(result.decision).toBe('block')
    expect(result.reasons).toEqual([
      'canary_error_rate',
      'canary_latency',
      'canary_unhealthy',
      'database_migration_unverified',
      'mutable_image',
      'unsupported_api_contract',
      'unsupported_database_contract',
    ])
  })

  test('orders rollback when a compatible candidate fails its canary budget', () => {
    const result = assessDeployment({
      current,
      candidate: {
        ...current,
        releaseId: 'release-102',
        commitSha: 'd'.repeat(40),
        images: { 'control-api': `registry/control-api@sha256:${'3'.repeat(64)}` },
      },
      compatibility: { api: [1], database: [18], runtimeGateway: [1] },
      canary: { healthy: false, errorRate: 0, p95LatencyMs: 90 },
      budgets: { maximumErrorRate: 0, maximumP95LatencyMs: 100 },
    })

    expect(result).toEqual({ decision: 'rollback', reasons: ['canary_unhealthy'] })
  })

  test('blocks image-set drift and database downgrades even with migration evidence', () => {
    const result = assessDeployment({
      current: {
        ...current,
        images: {
          ...current.images,
          'runtime-worker': `registry/runtime-worker@sha256:${'4'.repeat(64)}`,
        },
      },
      candidate: {
        ...current,
        releaseId: 'release-downgrade',
        commitSha: 'e'.repeat(40),
        contracts: { ...current.contracts, database: 17 },
      },
      compatibility: { api: [1], database: [17, 18], runtimeGateway: [1] },
      migration: { from: 18, to: 17, applied: true, rollbackRestoreVerified: true },
      canary: { healthy: true, errorRate: 0, p95LatencyMs: 1 },
      budgets: { maximumErrorRate: 0, maximumP95LatencyMs: 100 },
    })

    expect(result).toEqual({
      decision: 'block',
      reasons: ['database_downgrade', 'image_set_mismatch'],
    })
  })
})

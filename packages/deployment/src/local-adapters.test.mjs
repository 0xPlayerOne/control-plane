import { describe, expect, test } from 'bun:test'
import {
  BufferedObservabilityProvider,
  LocalCoordinationProvider,
  StaticServiceDiscovery,
} from './index.ts'

describe('local deployment adapters', () => {
  test('discovers only explicitly configured endpoints', async () => {
    const discovery = new StaticServiceDiscovery([
      { service: 'restate', url: new globalThis.URL('http://127.0.0.1:8080'), private: true },
    ])
    expect((await discovery.resolve('restate')).url.toString()).toBe('http://127.0.0.1:8080/')
    await expect(discovery.resolve('unknown')).rejects.toThrow('SERVICE_ENDPOINT_NOT_FOUND')
  })

  test('provides owner-bound leases without stale release races', async () => {
    let now = Date.parse('2026-08-29T00:00:00.000Z')
    const coordination = new LocalCoordinationProvider(() => now)
    const first = await coordination.acquire('execution', 'local-daemon', 100)
    expect(await coordination.acquire('execution', 'local-daemon', 100)).toBeUndefined()
    now += 101
    const replacement = await coordination.acquire('execution', 'local-daemon', 100)
    await first.release()
    expect(replacement).toBeDefined()
    expect(await coordination.acquire('execution', 'local-daemon', 100)).toBeUndefined()
  })

  test('bounds local telemetry memory', async () => {
    const observability = new BufferedObservabilityProvider(1)
    observability.record({ name: 'started', occurredAt: new Date().toISOString(), attributes: {} })
    observability.record({ name: 'ready', occurredAt: new Date().toISOString(), attributes: {} })
    expect(observability.events.map(({ name }) => name)).toEqual(['ready'])
    expect(await observability.health()).toMatchObject({ ready: true })
  })
})

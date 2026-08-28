import { describe, expect, test } from 'bun:test'
import {
  ContextProviderResolver,
  InMemoryContextContributionCache,
  createFakeContextProvider,
  runContextProviderConformance,
} from './provider.ts'

const workspaceId = 'wsp_01JABCDEF0123456789ABCDEFG'
const scopeDigest = `sha256:${'a'.repeat(64)}`
const now = '2026-08-25T12:00:00.000Z'

describe('optional context provider resolution', () => {
  test('preserves the no-provider execution path when disabled or unconfigured', async () => {
    const disabled = await resolver([]).resolve(request({ mode: 'disabled' }))
    expect(disabled).toEqual({
      status: 'disabled',
      contributions: [],
      pins: [],
      decisionReasons: ['POLICY_DISABLED'],
    })

    const absent = await resolver([]).resolve(request())
    expect(absent).toMatchObject({ status: 'omitted', contributions: [], pins: [] })
  })

  test('selects by scope, policy, location, capability, health, and budget', async () => {
    const wrongScope = fake('A', { scopeDigest: `sha256:${'b'.repeat(64)}` })
    const incapable = fake('B', { capabilities: { evidenceSearch: false } })
    const healthy = fake('C')
    const result = await resolver([wrongScope, incapable, healthy]).resolve(request())

    expect(result.status).toBe('included')
    expect(result.contributions.map((entry) => entry.content)).toEqual(['evidence-C'])
    expect(result.pins[0]).toMatchObject({
      providerId: healthy.readModel.definition.providerId,
      scopeDigest,
      revision: 'revision-C',
      included: true,
    })
    expect(JSON.stringify(result.pins)).not.toContain('evidence-C')
    expect(JSON.stringify(result.pins)).not.toMatch(/credential|secret/i)
  })

  test('never broadens scope and applies pinned failure behavior', async () => {
    const unavailable = fake('A', { health: 'unavailable' })
    await expect(
      resolver([unavailable]).resolve(request({ mode: 'required', failureBehavior: 'fail' }))
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })

    const awaiting = await resolver([unavailable]).resolve(
      request({ mode: 'required', failureBehavior: 'await_input' })
    )
    expect(awaiting.status).toBe('awaiting_input')

    const revoked = fake('B', { state: 'revoked' })
    await expect(
      resolver([revoked]).resolve(request({ mode: 'required', failureBehavior: 'fail' }))
    ).rejects.toMatchObject({ code: 'PROVIDER_REVOKED' })
  })

  test('rejects stale, over-budget, and scope-mismatched output and substitutes deterministically', async () => {
    const stale = fake('A', { expiresAt: '2026-08-25T11:00:00.000Z' })
    const oversized = fake('B', { tokenCount: 101 })
    const substitute = fake('C')
    const result = await resolver([stale, oversized, substitute]).resolve(request())
    expect(result.contributions[0].content).toBe('evidence-C')

    const malicious = fake('D', { outputScopeDigest: `sha256:${'d'.repeat(64)}` })
    await expect(
      resolver([malicious]).resolve(request({ mode: 'required', failureBehavior: 'fail' }))
    ).rejects.toMatchObject({ code: 'PROVIDER_SCOPE_MISMATCH' })
  })

  test('normalizes degraded output without making it ProjectState or canonical memory', async () => {
    const degraded = fake('A', { health: 'degraded', degraded: true })
    const result = await resolver([degraded]).resolve(request())
    expect(result.status).toBe('degraded')
    expect(result.contributions[0]).toMatchObject({ kind: 'evidence', degraded: true })
    expect(result).not.toHaveProperty('projectState')
    expect(result).not.toHaveProperty('canonicalMemory')
  })

  test('enforces the provider latency bound', async () => {
    const slow = fake('S', { delayMs: 20 })
    await expect(
      resolver([slow]).resolve(
        request({ mode: 'required', failureBehavior: 'fail', maximumLatencyMs: 1 })
      )
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
  })

  test('provides two fake profiles and a reusable conformance harness', async () => {
    const evidence = fake('E')
    const memory = fake('M', {
      capabilities: { evidenceSearch: false, memoryRecall: true },
      kind: 'memory',
    })
    expect(evidence.readModel.definition.providerType).not.toBe(
      memory.readModel.definition.providerType
    )
    expect(await runContextProviderConformance(evidence, request())).toEqual({
      bounded: true,
      deterministic: true,
      scopePreserved: true,
    })
  })

  test('reuses only scope- and policy-bound contribution cache entries', async () => {
    const cache = new InMemoryContextContributionCache()
    const provider = fake('K')
    let retrievals = 0
    const counted = {
      ...provider,
      async retrieve(input) {
        retrievals += 1
        return provider.retrieve(input)
      },
    }
    const selected = resolver([counted], { cache })
    await selected.resolve(request())
    await selected.resolve(request())
    await selected.resolve(request({ maximumTokens: 99 }))
    expect(retrievals).toBe(2)
  })

  test('ranks explicit connections before provider preference and reachability', async () => {
    const direct = fake('A', { reachability: 'direct', latencyClass: 'low', costClass: 'low' })
    const preferred = fake('B', {
      reachability: 'remote',
      latencyClass: 'high',
      costClass: 'premium',
    })
    const explicit = fake('C', {
      reachability: 'remote',
      latencyClass: 'high',
      costClass: 'premium',
    })

    const preferredResult = await resolver([direct, preferred]).resolve(
      request({ providerIds: [preferred.readModel.definition.providerId] })
    )
    expect(preferredResult.pins[0].providerId).toBe(preferred.readModel.definition.providerId)
    expect(preferredResult.decisionReasons).toContain('PREFERRED_PROVIDER')

    const explicitResult = await resolver([direct, preferred, explicit]).resolve(
      request({ connectionIds: [explicit.readModel.connection.connectionId] })
    )
    expect(explicitResult.pins[0].connectionId).toBe(explicit.readModel.connection.connectionId)
    expect(explicitResult.decisionReasons).toContain('EXPLICIT_CONNECTION')
  })
})

function resolver(providers, options) {
  return new ContextProviderResolver(providers, options)
}

function fake(suffix, overrides = {}) {
  return createFakeContextProvider({
    suffix,
    workspaceId,
    scopeDigest,
    health: 'healthy',
    state: 'active',
    capabilities: { evidenceSearch: true, memoryRecall: false },
    kind: 'evidence',
    tokenCount: 10,
    ...overrides,
  })
}

function request(policy = {}) {
  return {
    workspaceId,
    scopeDigest,
    principalRef: 'principal://test/user',
    executionLocation: 'cloud',
    capability: 'evidenceSearch',
    now,
    policy: {
      mode: 'preferred',
      providerIds: [],
      includeEvidence: true,
      includeMemory: false,
      maximumTokens: 100,
      maximumAgeSeconds: 3_600,
      maximumLatencyMs: 1_000,
      failureBehavior: 'continue_without',
      ...policy,
    },
  }
}

import { describe, expect, test } from 'bun:test'
import { routeRuntimeConnections, toAttemptRoutingDecision } from './index.ts'

const ids = {
  plan: 'pln_01JABCDEF0123456789ABCDEFG',
  local: 'rtc_01JABCDEF0123456789ABCDEFG',
  cloud: 'rtc_01JBBCDEF0123456789ABCDEFG',
  denied: 'rtc_01JZBCDEF0123456789ABCDEFG',
}

function eligibility(runtimeConnectionId, overrides = {}) {
  return {
    eligible: true,
    mode: 'full',
    reasons: [],
    degradations: [],
    audit: {
      eligibilityVersion: 1,
      executionPlanId: ids.plan,
      runtimeConnectionId,
      policySnapshot: {
        policyId: 'workspace-standard',
        version: 3,
        digest: `sha256:${'a'.repeat(64)}`,
      },
      evaluatedAt: '2026-08-24T20:01:30.000Z',
      inputDigest: `sha256:${'b'.repeat(64)}`,
    },
    ...overrides,
  }
}

function candidate(runtimeConnectionId, overrides = {}) {
  return {
    runtimeConnectionId,
    family: 'pi',
    deployment: runtimeConnectionId === ids.cloud ? 'managed' : 'local',
    eligibility: eligibility(runtimeConnectionId),
    signals: {
      locality: runtimeConnectionId === ids.local ? 100 : 40,
      health: 90,
      loadPermille: runtimeConnectionId === ids.local ? 300 : 100,
      queueDepth: runtimeConnectionId === ids.local ? 2 : 0,
      entitlementPriority: 50,
      costClass: runtimeConnectionId === ids.local ? 'low' : 'medium',
    },
    ...overrides,
  }
}

function input(overrides = {}) {
  return {
    routingVersion: 1,
    executionPlanId: ids.plan,
    evaluatedAt: '2026-08-24T20:01:31.000Z',
    policy: {
      policyId: 'runtime-standard',
      version: 1,
      digest: `sha256:${'c'.repeat(64)}`,
      weights: {
        explicitConnection: 1_000_000,
        preferredFamily: 100_000,
        preferredDeployment: 10_000,
        locality: 100,
        health: 100,
        load: 10,
        queue: 10,
        entitlement: 10,
        cost: 10,
      },
    },
    candidates: [candidate(ids.local), candidate(ids.cloud)],
    ...overrides,
  }
}

function permutations(values) {
  if (values.length < 2) return [values]
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidateIndex) => candidateIndex !== index)).map((rest) => [
      value,
      ...rest,
    ])
  )
}

describe('runtime routing', () => {
  test('ranks only eligible candidates and returns explainable alternatives', () => {
    const denied = candidate(ids.denied, {
      eligibility: eligibility(ids.denied, {
        eligible: false,
        mode: 'ineligible',
        reasons: [{ code: 'SECURITY_POLICY_DENIED' }],
      }),
    })
    const decision = routeRuntimeConnections(input({ candidates: [...input().candidates, denied] }))

    expect(decision.outcome).toBe('selected')
    expect(decision.selected.runtimeConnectionId).toBe(ids.local)
    expect(decision.ranked.map(({ runtimeConnectionId }) => runtimeConnectionId)).toEqual([
      ids.local,
      ids.cloud,
    ])
    expect(decision.ranked[0].reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'LOCALITY', contribution: 10_000 }),
        expect.objectContaining({ code: 'HEALTH', contribution: 9_000 }),
      ])
    )
    expect(decision.excluded).toEqual([
      { runtimeConnectionId: ids.denied, eligibilityReasons: ['SECURITY_POLICY_DENIED'] },
    ])
    expect(toAttemptRoutingDecision(decision)).toMatchObject({
      routingVersion: 1,
      policy: { policyId: 'runtime-standard', version: 1 },
      selectedRank: 1,
      candidateCount: 2,
      reasonCodes: expect.arrayContaining(['HEALTH', 'LOCALITY']),
      decisionDigest: decision.audit.decisionDigest,
    })
    expect(() =>
      toAttemptRoutingDecision({
        ...decision,
        selected: { ...decision.selected, score: decision.selected.score + 1 },
      })
    ).toThrow('ROUTING_DECISION_DIGEST_MISMATCH')
  })

  test('applies explicit preference only among eligible candidates', () => {
    const decision = routeRuntimeConnections(
      input({ preference: { runtimeConnectionId: ids.cloud, family: 'pi', deployment: 'managed' } })
    )
    const deniedPreferred = routeRuntimeConnections(
      input({
        preference: { runtimeConnectionId: ids.denied },
        candidates: [
          ...input().candidates,
          candidate(ids.denied, {
            eligibility: eligibility(ids.denied, {
              eligible: false,
              mode: 'ineligible',
              reasons: [{ code: 'RUNTIME_CONNECTION_POLICY_DENIED' }],
            }),
          }),
        ],
      })
    )

    expect(decision.selected.runtimeConnectionId).toBe(ids.cloud)
    expect(decision.selected.reasons.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['EXPLICIT_CONNECTION', 'PREFERRED_DEPLOYMENT', 'PREFERRED_FAMILY'])
    )
    expect(deniedPreferred.outcome).toBe('preference_unavailable')
    expect(deniedPreferred.selected.runtimeConnectionId).not.toBe(ids.denied)
  })

  test('is invariant to candidate order and breaks exact ties by connection ID', () => {
    const tied = [
      candidate(ids.local, { signals: candidate(ids.cloud).signals }),
      candidate(ids.cloud),
      candidate(ids.denied, {
        family: 'acp',
        deployment: 'managed',
        eligibility: eligibility(ids.denied),
        signals: candidate(ids.cloud).signals,
      }),
    ]
    const decisions = permutations(tied).map((candidates) =>
      routeRuntimeConnections(input({ candidates }))
    )

    expect(new Set(decisions.map(({ audit }) => audit.inputDigest)).size).toBe(1)
    expect(new Set(decisions.map(({ audit }) => audit.decisionDigest)).size).toBe(1)
    expect(new Set(decisions.map(({ selected }) => selected.runtimeConnectionId)).size).toBe(1)
    expect(decisions[0].selected.runtimeConnectionId).toBe(ids.local)
  })

  test('classifies empty, transiently unavailable, and policy-ineligible candidate sets', () => {
    const empty = routeRuntimeConnections(input({ candidates: [] }))
    const transient = routeRuntimeConnections(
      input({
        candidates: [
          candidate(ids.local, {
            eligibility: eligibility(ids.local, {
              eligible: false,
              mode: 'ineligible',
              reasons: [{ code: 'RUNTIME_STALE' }],
            }),
          }),
        ],
      })
    )
    const denied = routeRuntimeConnections(
      input({
        candidates: [
          candidate(ids.local, {
            eligibility: eligibility(ids.local, {
              eligible: false,
              mode: 'ineligible',
              reasons: [{ code: 'ENTITLEMENT_DENIED' }],
            }),
          }),
        ],
      })
    )

    expect(empty).toMatchObject({ outcome: 'no_candidate', ranked: [], excluded: [] })
    expect(transient).toMatchObject({ outcome: 'transient_unavailable', ranked: [] })
    expect(denied).toMatchObject({ outcome: 'no_candidate', ranked: [] })
  })
})

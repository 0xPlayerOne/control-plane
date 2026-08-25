import { describe, expect, test } from 'bun:test'
import { InMemoryUsageLedger } from './index.js'

const ids = {
  workspaceId: 'wsp_01JABCDEF0123456789ABCDEFG',
  executionId: 'exe_01JABCDEF0123456789ABCDEFG',
  attemptId: 'att_01JABCDEF0123456789ABCDEFG',
}

const source = (id, key = id) => ({ sourceId: id, idempotencyKey: key })

describe('authoritative usage ledger', () => {
  test('deduplicates one billable effect across retry and rejects identity conflicts', () => {
    const ledger = fixture()
    const first = ledger.charge({
      ...ids,
      reservationKey: 'model-reservation',
      kind: 'model_usage',
      source: source('provider-request-1'),
      quantity: { unit: 'tokens', value: 100 },
      costMicrounits: 300_000,
      fundingSource: 'hq_managed',
    })
    const duplicate = ledger.charge({
      ...ids,
      reservationKey: 'model-reservation',
      kind: 'model_usage',
      source: source('provider-request-1'),
      quantity: { unit: 'tokens', value: 100 },
      costMicrounits: 300_000,
      fundingSource: 'hq_managed',
    })

    expect(duplicate).toEqual(first)
    expect(
      ledger.entries(ids.executionId).filter((entry) => entry.kind === 'model_usage')
    ).toHaveLength(1)
    expect(() =>
      ledger.charge({
        ...ids,
        reservationKey: 'model-reservation',
        kind: 'model_usage',
        source: source('provider-request-1'),
        quantity: { unit: 'tokens', value: 101 },
        costMicrounits: 300_000,
        fundingSource: 'hq_managed',
      })
    ).toThrow('IDEMPOTENCY_CONFLICT')
  })

  test('reserves before work and reconciles settlement by releasing the unused amount', () => {
    const ledger = fixture()
    ledger.charge({
      ...ids,
      reservationKey: 'model-reservation',
      kind: 'model_usage',
      source: source('provider-request-2'),
      quantity: { unit: 'tokens', value: 250 },
      costMicrounits: 400_000,
      fundingSource: 'hq_managed',
    })
    const settlement = ledger.settle({
      executionId: ids.executionId,
      reservationKey: 'model-reservation',
      source: source('settlement-1'),
    })

    expect(settlement.releasedMicrounits).toBe(600_000)
    expect(
      ledger.settle({
        executionId: ids.executionId,
        reservationKey: 'model-reservation',
        source: source('settlement-1'),
      })
    ).toEqual(settlement)
    expect(ledger.summary(ids.executionId)).toMatchObject({
      maximumMicrounits: 2_000_000,
      spentMicrounits: 400_000,
      reservedMicrounits: 0,
      availableMicrounits: 1_600_000,
      settled: true,
    })
    expect(ledger.entries(ids.executionId).map((entry) => entry.kind)).toEqual([
      'reservation',
      'model_usage',
      'release',
      'settlement',
    ])
  })

  test('blocks hard-budget overrun unless an explicit authorized extension is recorded', () => {
    const ledger = fixture()
    expect(() =>
      ledger.charge({
        ...ids,
        reservationKey: 'model-reservation',
        kind: 'tool_charge',
        source: source('tool-1'),
        quantity: { unit: 'calls', value: 1 },
        costMicrounits: 1_000_001,
        fundingSource: 'hq_managed',
      })
    ).toThrow('BUDGET_EXHAUSTED')

    ledger.extendBudget({
      executionId: ids.executionId,
      additionalMicrounits: 500_000,
      authorizationDecisionId: `sha256:${'a'.repeat(64)}`,
      source: source('extension-1'),
    })
    ledger.extendReservation({
      executionId: ids.executionId,
      reservationKey: 'model-reservation',
      additionalMicrounits: 500_000,
      authorizationDecisionId: `sha256:${'b'.repeat(64)}`,
      source: source('reservation-extension-1'),
    })
    expect(
      ledger.charge({
        ...ids,
        reservationKey: 'model-reservation',
        kind: 'tool_charge',
        source: source('tool-1'),
        quantity: { unit: 'calls', value: 1 },
        costMicrounits: 1_200_000,
        fundingSource: 'hq_managed',
      }).kind
    ).toBe('tool_charge')
  })

  test('enforces hard token limits during execution', () => {
    const ledger = fixture()
    expect(() =>
      ledger.charge({
        ...ids,
        reservationKey: 'model-reservation',
        kind: 'model_usage',
        source: source('too-many-tokens'),
        quantity: { unit: 'tokens', value: 1_001 },
        costMicrounits: 1,
        fundingSource: 'hq_managed',
      })
    ).toThrow('BUDGET_EXHAUSTED')
  })

  test('inherits child limits without allowing the child to escape its parent budget', () => {
    const ledger = fixture()
    const childExecutionId = 'exe_01JABCDEF0123456789ABCDEFH'
    ledger.openBudget({
      workspaceId: ids.workspaceId,
      executionId: childExecutionId,
      parentExecutionId: ids.executionId,
      currency: 'USD',
      maximumMicrounits: 1_500_000,
      source: source('child-open'),
    })
    expect(ledger.summary(childExecutionId).maximumMicrounits).toBe(1_000_000)
    expect(ledger.summary(ids.executionId).reservedMicrounits).toBe(2_000_000)
    expect(() =>
      ledger.openBudget({
        workspaceId: ids.workspaceId,
        executionId: 'exe_01JABCDEF0123456789ABCDEFJ',
        parentExecutionId: ids.executionId,
        currency: 'USD',
        maximumMicrounits: 1,
        source: source('second-child'),
      })
    ).toThrow('BUDGET_EXHAUSTED')
  })

  test('classifies external-subscription usage without claiming exact HQ provider cost', () => {
    const ledger = fixture()
    const entry = ledger.charge({
      ...ids,
      reservationKey: 'model-reservation',
      kind: 'model_usage',
      source: source('external-call'),
      quantity: { unit: 'tokens', value: 500 },
      costMicrounits: 0,
      fundingSource: 'external_subscription',
    })
    expect(entry).toMatchObject({
      fundingSource: 'external_subscription',
      costExact: false,
      costMicrounits: 0,
    })
    expect(() =>
      ledger.charge({
        ...ids,
        reservationKey: 'model-reservation',
        kind: 'model_usage',
        source: source('false-exact-cost'),
        quantity: { unit: 'tokens', value: 500 },
        costMicrounits: 1,
        fundingSource: 'external_subscription',
      })
    ).toThrow('INVALID_ENTRY')
  })

  test('normalizes tool and sandbox usage and exposes safe append-only summaries', () => {
    const ledger = fixture()
    ledger.charge({
      ...ids,
      reservationKey: 'model-reservation',
      kind: 'sandbox_usage',
      source: source('sandbox-minute-1'),
      quantity: { unit: 'milliseconds', value: 5_000 },
      costMicrounits: 100_000,
      fundingSource: 'hq_managed',
    })
    const before = ledger.entries(ids.executionId)
    expect(Object.isFrozen(before[0])).toBe(true)
    expect(ledger.publicSummary(ids.executionId)).toEqual({
      executionId: ids.executionId,
      currency: 'USD',
      funding: { hqManagedMicrounits: 100_000, externalSubscriptionEffects: 0 },
      usage: { milliseconds: 5_000 },
      settled: false,
    })
    expect(JSON.stringify(ledger.publicSummary(ids.executionId))).not.toMatch(
      /sourceId|idempotencyKey/
    )
  })
})

function fixture() {
  const ledger = new InMemoryUsageLedger({ now: () => '2026-08-25T12:00:00.000Z' })
  ledger.openBudget({
    workspaceId: ids.workspaceId,
    executionId: ids.executionId,
    currency: 'USD',
    maximumMicrounits: 2_000_000,
    maximumTokens: 1_000,
    source: source('budget-open'),
  })
  ledger.reserve({
    ...ids,
    reservationKey: 'model-reservation',
    maximumMicrounits: 1_000_000,
    source: source('reservation-1'),
  })
  return ledger
}

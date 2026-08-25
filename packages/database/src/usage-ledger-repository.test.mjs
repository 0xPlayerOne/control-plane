import { expect, test } from 'bun:test'
import { fromUsageLedgerRow, toUsageLedgerRow } from './usage-ledger-repository.js'

test('usage ledger row conversion preserves immutable attribution fields', () => {
  const entry = {
    entryId: 'usg_01JABCDEF0123456789ABCDEFG',
    sequence: 1,
    workspaceId: 'wsp_01JABCDEF0123456789ABCDEFG',
    executionId: 'exe_01JABCDEF0123456789ABCDEFG',
    attemptId: 'att_01JABCDEF0123456789ABCDEFG',
    kind: 'model_usage',
    source: { sourceId: 'provider-request', idempotencyKey: 'model-call-1' },
    reservationKey: 'models',
    fundingSource: 'hq_managed',
    quantity: { unit: 'tokens', value: 128 },
    currency: 'USD',
    costMicrounits: 42,
    costExact: true,
    recordedAt: '2026-08-25T12:00:00.000Z',
  }
  const row = toUsageLedgerRow(entry)
  expect(fromUsageLedgerRow(row)).toEqual(entry)
  expect(row).not.toHaveProperty('credential')
})

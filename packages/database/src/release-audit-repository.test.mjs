import { expect, test } from 'bun:test'
import { fromReleaseAuditRow, toReleaseAuditRow } from './release-audit-repository.js'

const record = {
  releaseAuditId: '018f6f64-8d3a-7c11-b043-001122334455',
  releaseGateId: 'gate-profile-default',
  action: 'rollback',
  actor: 'operator://incident',
  fromRunId: 'eval-run-candidate',
  toRunId: 'eval-run-baseline',
  reason: 'latency regression',
  at: '2026-08-25T12:00:00.000Z',
}

test('release audit row conversion preserves immutable decision evidence', () => {
  expect(fromReleaseAuditRow(toReleaseAuditRow(record))).toEqual(record)
})

test('release audit row conversion rejects indexed fields that disagree with evidence', () => {
  const row = toReleaseAuditRow(record)

  expect(() => fromReleaseAuditRow({ ...row, action: 'promote' })).toThrow(
    'RELEASE_AUDIT_ROW_INCONSISTENT'
  )
  expect(() => fromReleaseAuditRow({ ...row, releaseGateId: 'gate-unrelated' })).toThrow(
    'RELEASE_AUDIT_ROW_INCONSISTENT'
  )
})

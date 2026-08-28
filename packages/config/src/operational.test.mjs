import { describe, expect, test } from 'bun:test'
import {
  loadOperationalPolicy,
  managedCloudOperationalPolicy,
  operationalPolicyDigest,
  retryDelayMs,
} from './index.ts'

describe('managed-cloud operational policy', () => {
  test('publishes the accepted bounded defaults and a stable digest', () => {
    expect(managedCloudOperationalPolicy.heartbeat).toEqual({
      intervalMs: 15_000,
      degradedAfterMisses: 2,
      offlineAfterMisses: 3,
    })
    expect(managedCloudOperationalPolicy.retention.commandInboxMs).toBe(30 * 24 * 60 * 60 * 1_000)
    expect(managedCloudOperationalPolicy.payload.gatewayFrameBytes).toBe(1_048_576)
    expect(operationalPolicyDigest(managedCloudOperationalPolicy)).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  test('uses full jitter within the exponential cap and rejects unsafe overrides', () => {
    expect(retryDelayMs(managedCloudOperationalPolicy, 1, () => 0)).toBe(0)
    expect(retryDelayMs(managedCloudOperationalPolicy, 7, () => 1)).toBe(60_000)
    expect(() =>
      loadOperationalPolicy({
        ...managedCloudOperationalPolicy,
        heartbeat: { ...managedCloudOperationalPolicy.heartbeat, offlineAfterMisses: 2 },
      })
    ).toThrow()
    expect(() =>
      loadOperationalPolicy({
        ...managedCloudOperationalPolicy,
        retention: { ...managedCloudOperationalPolicy.retention, commandInboxMs: 1 },
      })
    ).toThrow()
  })
})

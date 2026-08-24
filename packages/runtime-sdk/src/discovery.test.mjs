import { describe, expect, test } from 'bun:test'
import {
  assessExternalSession,
  ExternalSessionRegistry,
  InMemoryExternalSessionRepository,
  projectExternalSessionDiscovery,
  projectRuntimeConnectionDiscovery,
} from './index.ts'

describe('Agent HQ runtime discovery projection', () => {
  test('keeps node health distinct while exposing stale capability mismatch remediation', () => {
    const model = projectRuntimeConnectionDiscovery({
      connection: connection({
        status: 'degraded',
        health: 'degraded',
        availabilityState: 'stale',
        compatibilityState: 'capability_missing',
        capabilities: [{ name: 'session.resume', support: 'degraded' }],
      }),
      family: 'codex',
      node: {
        runtimeNodeRefId: 'rnr_01JABCDEF0123456789ABCDEFG',
        authority: 'agent_hq',
        displayName: 'Developer Mac',
        location: 'local_device',
        status: 'online',
        observedAt: '2026-08-24T20:01:20.000Z',
      },
      nodeHealth: 'online',
      evaluatedAt: '2026-08-24T20:02:30.000Z',
      localProjectGrant: { required: true, state: 'missing' },
      entitlement: { state: 'allowed', class: 'standard' },
      requiredCapabilities: ['session.resume'],
    })

    expect(model).toMatchObject({
      node: { health: 'online' },
      connection: { health: 'degraded', availability: 'stale' },
      freshness: { state: 'stale' },
      eligibility: { state: 'ineligible' },
    })
    expect(model.eligibility.reasons).toEqual([
      'LOCAL_PROJECT_GRANT_MISSING',
      'REQUIRED_CAPABILITY_INSUFFICIENT',
      'RUNTIME_INCOMPATIBLE',
      'RUNTIME_STALE',
    ])
    expect(model.eligibility.remediation.map(({ code }) => code)).toEqual([
      'GRANT_PROJECT_ACCESS',
      'REFRESH_RUNTIME',
      'SELECT_COMPATIBLE_RUNTIME',
    ])
    expect(JSON.stringify(model)).not.toContain('opaqueNativeRef')
  })

  test('projects revoked external sessions without opaque native state', async () => {
    const registry = new ExternalSessionRegistry(new InMemoryExternalSessionRepository())
    const session = await registry.register(sessionRegistration({ state: 'revoked' }))
    const assessment = assessExternalSession(session, {
      connection: connection({
        status: 'revoked',
        health: 'unavailable',
        availabilityState: 'revoked',
        compatibilityState: 'revoked',
      }),
      nodeStatus: 'revoked',
      evaluatedAt: '2026-08-24T20:01:30.000Z',
    })

    const model = projectExternalSessionDiscovery({ session, assessment })

    expect(model).toMatchObject({
      state: 'revoked',
      recoverable: false,
      capabilitySummary: {
        controls: { resume: { available: false, reason: 'SESSION_REVOKED' } },
      },
    })
    expect(JSON.stringify(model)).not.toContain('opaqueNativeSessionId')
    expect(JSON.stringify(model)).not.toContain('ownership')
  })
})

function connection(overrides = {}) {
  return {
    runtimeConnectionId: 'rtc_01JABCDEF0123456789ABCDEFG',
    identityDigest: `sha256:${'1'.repeat(64)}`,
    connectionType: 'managed_local',
    runtimeNodeRefId: 'rnr_01JABCDEF0123456789ABCDEFG',
    runtimeDefinitionId: 'rtd_01JABCDEF0123456789ABCDEFG',
    location: 'local_device',
    opaqueNativeRef: 'nref_01JABCDEF0123456789ABCDEFG',
    adapterVersion: '1.0.0',
    driverVersion: '1.0.0',
    harnessVersion: '1.0.0',
    protocolVersion: '1.0.0',
    status: 'connected',
    health: 'healthy',
    availabilityState: 'healthy',
    capabilities: [{ name: 'session.resume', support: 'supported' }],
    capabilitySnapshotVersion: 1,
    capabilitySnapshotObservedAt: '2026-08-24T20:01:00.000Z',
    capabilitySnapshotExpiresAt: '2026-08-24T20:02:00.000Z',
    capabilityVerification: 'verified',
    compatibilityState: 'compatible',
    limitations: [],
    diagnostics: [],
    lastDiscoveredAt: '2026-08-24T20:01:00.000Z',
    lastHeartbeatAt: '2026-08-24T20:01:00.000Z',
    lastHealthCheckAt: '2026-08-24T20:01:00.000Z',
    version: 2,
    createdAt: '2026-08-24T20:00:00.000Z',
    updatedAt: '2026-08-24T20:01:00.000Z',
    ...overrides,
  }
}

function sessionRegistration(overrides = {}) {
  return {
    externalSessionId: 'ses_01JABCDEF0123456789ABCDEFG',
    runtimeConnectionId: 'rtc_01JABCDEF0123456789ABCDEFG',
    opaqueNativeSessionId: 'nses_01JABCDEF0123456789ABCDEFG',
    workspaceId: 'wsp_01JABCDEF0123456789ABCDEFG',
    projectId: 'prj_01JABCDEF0123456789ABCDEFG',
    state: 'active',
    ownership: {
      authority: 'external_runtime',
      imported: false,
      concurrentNativeUse: 'allowed',
    },
    capabilitySnapshot: {
      version: 1,
      observedAt: '2026-08-24T20:01:00.000Z',
      expiresAt: '2026-08-24T20:02:00.000Z',
      operations: ['session.resume'],
    },
    safeMetadata: {
      origin: 'native_discovery',
      displayName: 'Planning session',
      limitations: [],
    },
    lastObservedAt: '2026-08-24T20:01:00.000Z',
    ...overrides,
  }
}

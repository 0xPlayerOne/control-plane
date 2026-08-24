import { describe, expect, test } from 'bun:test'
import {
  assessExternalSession,
  ExternalSessionRegistry,
  InMemoryExternalSessionRepository,
} from './index.ts'

const ids = {
  session: 'ses_01JABCDEF0123456789ABCDEFG',
  connection: 'rtc_01JABCDEF0123456789ABCDEFG',
  workspace: 'wsp_01JABCDEF0123456789ABCDEFG',
  project: 'prj_01JABCDEF0123456789ABCDEFG',
}

function registration(overrides = {}) {
  return {
    externalSessionId: ids.session,
    runtimeConnectionId: ids.connection,
    opaqueNativeSessionId: 'nses_01JABCDEF0123456789ABCDEFG',
    workspaceId: ids.workspace,
    projectId: ids.project,
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
      operations: ['session.resume', 'session.close'],
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

function connection(overrides = {}) {
  return {
    runtimeConnectionId: ids.connection,
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
    capabilities: [
      { name: 'session.resume', support: 'supported' },
      { name: 'session.close', support: 'supported' },
    ],
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

function context(overrides = {}) {
  return {
    connection: connection(),
    nodeStatus: 'online',
    evaluatedAt: '2026-08-24T20:01:30.000Z',
    ...overrides,
  }
}

describe('external session references', () => {
  test('registers idempotently and lists only the authorized workspace scope', async () => {
    const registry = new ExternalSessionRegistry(new InMemoryExternalSessionRepository())
    const first = await registry.register(registration())
    const replay = await registry.register(registration())

    expect(replay).toEqual(first)
    expect(await registry.list({ workspaceId: ids.workspace, projectId: ids.project })).toEqual([
      first,
    ])
    expect(
      await registry.list({
        workspaceId: 'wsp_01JBBCDEF0123456789ABCDEFG',
        projectId: ids.project,
      })
    ).toEqual([])
    expect(first).toMatchObject({
      version: 1,
      ownership: {
        authority: 'external_runtime',
        concurrentNativeUse: 'allowed',
      },
    })
  })

  test('represents resume without implying history or load', async () => {
    const registry = new ExternalSessionRegistry(new InMemoryExternalSessionRepository())
    const session = await registry.register(registration())
    const assessment = assessExternalSession(session, context())

    expect(assessment.state).toBe('active')
    expect(assessment.operations).toEqual({
      reference: { available: true },
      resume: { available: true },
      load: { available: false, reason: 'CAPABILITY_NOT_ADVERTISED' },
      close: { available: true },
      history: { available: false, reason: 'CAPABILITY_NOT_ADVERTISED' },
    })
  })

  test('makes stale, offline, missing-runtime, and capability-change states explicit', async () => {
    const registry = new ExternalSessionRegistry(new InMemoryExternalSessionRepository())
    const session = await registry.register(registration())
    const stale = assessExternalSession(
      session,
      context({ evaluatedAt: '2026-08-24T20:02:01.000Z' })
    )
    const offline = assessExternalSession(session, context({ nodeStatus: 'offline' }))
    const missing = assessExternalSession(session, context({ connection: undefined }))
    const changed = assessExternalSession(
      session,
      context({
        connection: connection({
          capabilities: [{ name: 'session.close', support: 'supported' }],
        }),
      })
    )

    expect(stale).toMatchObject({
      state: 'stale',
      recoverable: true,
      operations: { resume: { available: false, reason: 'SESSION_CAPABILITIES_STALE' } },
    })
    expect(offline).toMatchObject({
      state: 'offline',
      recoverable: true,
      operations: { resume: { available: false, reason: 'RUNTIME_OFFLINE' } },
    })
    expect(missing).toMatchObject({
      state: 'runtime_missing',
      recoverable: true,
      operations: { reference: { available: true } },
    })
    expect(changed).toMatchObject({
      state: 'capability_changed',
      recoverable: true,
      operations: { resume: { available: false, reason: 'CAPABILITY_NO_LONGER_ADVERTISED' } },
    })
  })

  test('retains removed references and makes revocation terminal', async () => {
    const registry = new ExternalSessionRegistry(new InMemoryExternalSessionRepository())
    const active = await registry.register(registration())
    const removed = await registry.update({
      externalSessionId: active.externalSessionId,
      expectedVersion: active.version,
      observedAt: '2026-08-24T20:01:30.000Z',
      state: 'removed',
    })
    const revoked = await registry.update({
      externalSessionId: removed.externalSessionId,
      expectedVersion: removed.version,
      observedAt: '2026-08-24T20:01:40.000Z',
      state: 'revoked',
    })

    expect(assessExternalSession(removed, context())).toMatchObject({
      state: 'removed',
      recoverable: true,
      operations: { reference: { available: true } },
    })
    expect(assessExternalSession(revoked, context())).toMatchObject({
      state: 'revoked',
      recoverable: false,
      operations: { reference: { available: true } },
    })
    await expect(
      registry.update({
        externalSessionId: revoked.externalSessionId,
        expectedVersion: revoked.version,
        observedAt: '2026-08-24T20:01:50.000Z',
        state: 'active',
      })
    ).rejects.toMatchObject({ code: 'SESSION_REVOKED' })
  })

  test('rejects sensitive native state and unsafe display metadata', async () => {
    const registry = new ExternalSessionRegistry(new InMemoryExternalSessionRepository())

    await expect(
      registry.register({ ...registration(), credential: 'secret' })
    ).rejects.toBeInstanceOf(Error)
    await expect(
      registry.register({
        ...registration(),
        safeMetadata: {
          ...registration().safeMetadata,
          displayName: '/Users/example/private/session',
        },
      })
    ).rejects.toBeInstanceOf(Error)
    await expect(
      registry.register({
        ...registration(),
        opaqueNativeSessionId: 'native:/Users/example/private/session',
      })
    ).rejects.toBeInstanceOf(Error)
  })

  test('uses optimistic updates without claiming exclusive native ownership', async () => {
    const registry = new ExternalSessionRegistry(new InMemoryExternalSessionRepository())
    const active = await registry.register(registration())
    await expect(
      registry.update({
        externalSessionId: active.externalSessionId,
        expectedVersion: active.version,
        observedAt: '2026-08-24T20:01:20.000Z',
        capabilitySnapshot: {
          ...active.capabilitySnapshot,
          operations: ['session.history'],
        },
      })
    ).rejects.toMatchObject({ code: 'CAPABILITY_SNAPSHOT_CONFLICT' })
    const outcomes = await Promise.allSettled([
      registry.update({
        externalSessionId: active.externalSessionId,
        expectedVersion: active.version,
        observedAt: '2026-08-24T20:01:30.000Z',
        safeMetadata: { ...active.safeMetadata, limitations: ['NATIVE_CLIENT_ACTIVE'] },
      }),
      registry.update({
        externalSessionId: active.externalSessionId,
        expectedVersion: active.version,
        observedAt: '2026-08-24T20:01:31.000Z',
        state: 'closed',
      }),
    ])

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    expect((await registry.get(active.externalSessionId)).ownership.concurrentNativeUse).toBe(
      'allowed'
    )
  })
})

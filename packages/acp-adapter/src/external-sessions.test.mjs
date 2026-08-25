import { describe, expect, test } from 'bun:test'
import {
  ExternalSessionRegistry,
  InMemoryExternalSessionRepository,
  assessExternalSession,
  projectExternalSessionDiscovery,
} from '@control-plane/runtime-sdk'
import { AcpAdapter, ReferenceAcpTransport } from './index.ts'

const now = '2026-08-25T12:00:00.000Z'
const ids = {
  workspace: 'wsp_01JABCDEF0123456789ABCDEFG',
  project: 'prj_01JABCDEF0123456789ABCDEFG',
  connection: 'rtc_01JABCDEF0123456789ABCDEFG',
}

function connection(overrides = {}) {
  return {
    runtimeConnectionId: ids.connection,
    identityDigest: `sha256:${'1'.repeat(64)}`,
    connectionType: 'external_local',
    runtimeNodeRefId: 'rnr_01JABCDEF0123456789ABCDEFG',
    runtimeDefinitionId: 'rtd_01JABCDEF0123456789ABCDEFG',
    location: 'local_device',
    opaqueNativeRef: 'nref_01JABCDEF0123456789ABCDEFG',
    adapterVersion: '1.0.0',
    driverVersion: '1.0.0',
    harnessVersion: '2.4.0',
    protocolVersion: '2.0.0',
    status: 'connected',
    health: 'healthy',
    availabilityState: 'healthy',
    capabilities: [
      'session.create',
      'session.list',
      'session.resume',
      'session.close',
      'session.history',
      'session.load',
    ].map((name) => ({ name, support: 'supported' })),
    capabilitySnapshotVersion: 3,
    capabilitySnapshotObservedAt: now,
    capabilitySnapshotExpiresAt: '2026-08-25T12:05:00.000Z',
    capabilityVerification: 'verified',
    compatibilityState: 'compatible',
    limitations: [],
    diagnostics: [],
    lastDiscoveredAt: now,
    lastHeartbeatAt: now,
    lastHealthCheckAt: now,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function fixture(options = {}) {
  const registry = new ExternalSessionRegistry(new InMemoryExternalSessionRepository())
  const transport = new ReferenceAcpTransport({
    now: () => now,
    nativeSessions: [
      { sessionId: 'native-session-1', title: 'Planning session' },
      { sessionId: 'native-session-2', title: '/Users/private/session' },
    ],
    sessionReplay: true,
    ...options.transport,
  })
  let currentConnection = connection()
  let nodeStatus = 'online'
  const externalIds = new Map([
    ['native-session-1', 'ses_01JABCDEF0123456789ABCDEFG'],
    ['native-session-2', 'ses_01JBBCDEF0123456789ABCDEFG'],
  ])
  const opaqueIds = new Map([
    ['native-session-1', 'nses_01JABCDEF0123456789ABCDEFG'],
    ['native-session-2', 'nses_01JBBCDEF0123456789ABCDEFG'],
  ])
  const adapter = new AcpAdapter({
    transport,
    adapterVersion: '1.0.0',
    externalSessionId: (nativeSessionId) => externalIds.get(nativeSessionId),
    interactionId: () => 'int_01JABCDEF0123456789ABCDEFG',
    now: () => new Date(now),
    externalSessions: {
      registry,
      runtimeConnection: () => currentConnection,
      nodeStatus: () => nodeStatus,
      workspaceId: ids.workspace,
      projectId: ids.project,
      opaqueNativeSessionId: (nativeSessionId) => opaqueIds.get(nativeSessionId),
      resolveNativeSessionId: async (opaqueNativeSessionId) =>
        options.resolveNative === false
          ? undefined
          : [...opaqueIds.entries()].find(([, opaque]) => opaque === opaqueNativeSessionId)?.[0],
      capabilityTtlMs: 300_000,
      authorize: async () => options.authorized !== false,
    },
  })
  return {
    adapter,
    registry,
    transport,
    setConnection: (value) => {
      currentConnection = value
    },
    setNodeStatus: (value) => {
      nodeStatus = value
    },
  }
}

describe('ACP external sessions', () => {
  test('lists native sessions as scoped opaque references and public read models', async () => {
    const { adapter, registry } = fixture()
    const result = await adapter.session({ operation: 'list' })
    const sessions = await registry.list({
      workspaceId: ids.workspace,
      projectId: ids.project,
      runtimeConnectionId: ids.connection,
    })

    expect(result.sessions.map(({ sessionId }) => sessionId)).toEqual([
      'ses_01JABCDEF0123456789ABCDEFG',
      'ses_01JBBCDEF0123456789ABCDEFG',
    ])
    expect(sessions[0]).toMatchObject({
      opaqueNativeSessionId: 'nses_01JABCDEF0123456789ABCDEFG',
      ownership: { authority: 'external_runtime', imported: false, concurrentNativeUse: 'allowed' },
      safeMetadata: { origin: 'native_discovery', displayName: 'Planning session' },
    })
    expect(sessions[1].safeMetadata.displayName).toBeUndefined()
    const readModel = projectExternalSessionDiscovery({
      session: sessions[0],
      assessment: assessExternalSession(sessions[0], {
        connection: connection(),
        nodeStatus: 'online',
        evaluatedAt: now,
      }),
    })
    expect(readModel).toMatchObject({
      externalSessionId: 'ses_01JABCDEF0123456789ABCDEFG',
      state: 'active',
      capabilitySummary: {
        controls: {
          resume: { available: true },
          history: { available: true },
          load: { available: true },
        },
      },
    })
    expect(JSON.stringify(readModel)).not.toMatch(/native-session|nses_|credential|\/Users\//)
  })

  test('resumes independently without requesting or fabricating history', async () => {
    const { adapter, transport } = fixture()
    const listed = await adapter.session({ operation: 'list' })
    const sessionId = listed.sessions[0].sessionId
    const resumed = await adapter.session({
      operation: 'resume',
      sessionId,
      idempotencyKey: 'resume:1',
    })

    expect(resumed).toMatchObject({ operation: 'resume', session: { sessionId, state: 'active' } })
    expect(transport.calls().at(-1)).toEqual({
      method: 'session/resume',
      params: { sessionId: 'native-session-1' },
    })
    expect(transport.replayCount()).toBe(0)
  })

  test('normalizes explicit ACP replay as complete or partial history and load', async () => {
    const { adapter, transport } = fixture({
      transport: { historyCompleteness: 'partial' },
    })
    const listed = await adapter.session({ operation: 'list' })
    const sessionId = listed.sessions[0].sessionId
    const history = await adapter.session({ operation: 'history', sessionId })
    const loaded = await adapter.session({
      operation: 'load',
      sessionId,
      idempotencyKey: 'load:1',
    })

    expect(history).toMatchObject({
      operation: 'history',
      completeness: 'partial',
      entries: [{ sequence: 1, data: { type: 'output', text: 'Earlier message' } }],
      limitations: ['ACP_HISTORY_PARTIAL'],
    })
    expect(loaded).toMatchObject({ operation: 'load', session: { sessionId, state: 'active' } })
    expect(transport.replayCount()).toBe(2)
  })

  test('removes controls after capability change and keeps offline references recoverable', async () => {
    const { adapter, registry, setConnection, setNodeStatus } = fixture()
    const listed = await adapter.session({ operation: 'list' })
    const sessionId = listed.sessions[0].sessionId
    const session = await registry.get(sessionId)
    setConnection(
      connection({
        capabilities: [{ name: 'session.close', support: 'supported' }],
        capabilitySnapshotVersion: 4,
      })
    )

    await expect(adapter.session({ operation: 'list' })).rejects.toMatchObject({
      code: 'ACP_SESSION_OPERATION_UNAVAILABLE',
      retryable: false,
    })
    await expect(
      adapter.session({ operation: 'resume', sessionId, idempotencyKey: 'resume:changed' })
    ).rejects.toMatchObject({ code: 'ACP_SESSION_OPERATION_UNAVAILABLE' })
    expect(
      projectExternalSessionDiscovery({
        session,
        assessment: assessExternalSession(session, {
          connection: connection({
            capabilities: [{ name: 'session.close', support: 'supported' }],
            capabilitySnapshotVersion: 4,
          }),
          nodeStatus: 'online',
          evaluatedAt: now,
        }),
      })
    ).toMatchObject({
      state: 'capability_changed',
      capabilitySummary: {
        controls: { resume: { available: false, reason: 'CAPABILITY_NO_LONGER_ADVERTISED' } },
      },
    })

    setNodeStatus('offline')
    setConnection(
      connection({ status: 'disconnected', health: 'unavailable', availabilityState: 'offline' })
    )
    await expect(
      adapter.session({ operation: 'close', sessionId, idempotencyKey: 'close:offline' })
    ).rejects.toMatchObject({ code: 'ACP_SESSION_OPERATION_UNAVAILABLE', retryable: true })
    expect((await registry.get(sessionId)).ownership.concurrentNativeUse).toBe('allowed')
  })

  test('retains safe concurrent native changes and marks sessions removed without claiming them', async () => {
    const { adapter, registry, transport } = fixture()
    const first = await adapter.session({ operation: 'list' })
    const sessionId = first.sessions[0].sessionId
    transport.setNativeSessionTitle('native-session-1', 'Renamed natively')
    transport.removeNativeSession('native-session-2')
    await adapter.session({ operation: 'list' })

    expect(await registry.get(sessionId)).toMatchObject({
      version: 2,
      state: 'active',
      ownership: { authority: 'external_runtime', concurrentNativeUse: 'allowed' },
      safeMetadata: { displayName: 'Renamed natively' },
    })
    expect(await registry.get('ses_01JBBCDEF0123456789ABCDEFG')).toMatchObject({
      state: 'removed',
      ownership: { concurrentNativeUse: 'allowed' },
    })
  })

  test('fails closed for unauthorized operations and stale opaque references', async () => {
    const denied = fixture({ authorized: false })
    await expect(denied.adapter.session({ operation: 'list' })).rejects.toMatchObject({
      code: 'ACP_SESSION_UNAUTHORIZED',
      retryable: false,
    })
    expect(denied.transport.calls().map(({ method }) => method)).toEqual(['initialize'])

    const stale = fixture({ resolveNative: false })
    const listed = await stale.adapter.session({ operation: 'list' })
    await expect(
      stale.adapter.session({
        operation: 'resume',
        sessionId: listed.sessions[0].sessionId,
        idempotencyKey: 'resume:stale',
      })
    ).rejects.toMatchObject({ code: 'ACP_SESSION_REFERENCE_STALE', retryable: true })
  })
})

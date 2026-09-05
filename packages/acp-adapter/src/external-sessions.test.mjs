import { describe, expect, test } from 'bun:test'
import { setTimeout as delay } from 'node:timers/promises'
import {
  ExternalSessionRegistry,
  DirectLocalRuntimeTransport,
  InMemoryExternalSessionRepository,
  assessExternalSession,
  projectExternalSessionDiscovery,
} from '@control-plane/runtime-sdk'
import { AcpAdapter, AcpDriver, ReferenceAcpTransport } from './index.ts'

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
  const projections = []
  const registry = new ExternalSessionRegistry(new InMemoryExternalSessionRepository())
  if (options.findDelayMs) {
    const findByNativeIdentity = registry.repository.findByNativeIdentity.bind(registry.repository)
    registry.repository.findByNativeIdentity = async (...arguments_) => {
      await delay(options.findDelayMs)
      return findByNativeIdentity(...arguments_)
    }
  } else if (options.firstFindDelayMs) {
    const findByNativeIdentity = registry.repository.findByNativeIdentity.bind(registry.repository)
    let findCount = 0
    registry.repository.findByNativeIdentity = async (...arguments_) => {
      findCount += 1
      if (findCount === 1) await delay(options.firstFindDelayMs)
      return findByNativeIdentity(...arguments_)
    }
  }
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
  let publishDelayMs = options.publishDelayMs ?? 0
  const externalIds = new Map([
    ['native-session-1', 'ses_01JABCDEF0123456789ABCDEFG'],
    ['native-session-2', 'ses_01JBBCDEF0123456789ABCDEFG'],
  ])
  const opaqueIds = new Map([
    ['native-session-1', 'nses_01JABCDEF0123456789ABCDEFG'],
    ['native-session-2', 'nses_01JBBCDEF0123456789ABCDEFG'],
  ])
  const adapter = new AcpAdapter({
    transport: new DirectLocalRuntimeTransport(
      new AcpDriver({
        transport,
        adapterVersion: '1.0.0',
        externalSessionId: (nativeSessionId) => externalIds.get(nativeSessionId),
        interactionId: () => 'int_01JABCDEF0123456789ABCDEFG',
        now: () => new Date(now),
        requestTimeoutMs: options.requestTimeoutMs,
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
              : [...opaqueIds.entries()].find(
                  ([, opaque]) => opaque === opaqueNativeSessionId
                )?.[0],
          capabilityTtlMs: 300_000,
          authorize: options.hangAuthorize
            ? async () => new Promise(() => {})
            : options.authorizeDelayMs
              ? async () => {
                  await delay(options.authorizeDelayMs)
                  return options.authorized !== false
                }
              : async () => options.authorized !== false,
          publishDiscovery: options.hangPublish
            ? async () => new Promise(() => {})
            : async (projection) => {
                if (publishDelayMs) await delay(publishDelayMs)
                projections.push(projection)
              },
        },
      })
    ),
  })
  return {
    adapter,
    registry,
    transport,
    projections,
    setConnection: (value) => {
      currentConnection = value
    },
    setNodeStatus: (value) => {
      nodeStatus = value
    },
    setPublishDelay: (value) => {
      publishDelayMs = value
    },
  }
}

describe('ACP external sessions', () => {
  test('publishes safe discovery projections for live session lifecycle changes', async () => {
    const { adapter, projections, transport } = fixture()

    await adapter.session({ operation: 'list' })
    expect(projections).toHaveLength(2)
    expect(projections[0]).toMatchObject({
      scope: {
        workspaceId: ids.workspace,
        projectId: ids.project,
        runtimeNodeRefId: 'rnr_01JABCDEF0123456789ABCDEFG',
      },
      model: {
        externalSessionId: 'ses_01JABCDEF0123456789ABCDEFG',
        state: 'active',
        display: { displayName: 'Planning session' },
      },
    })
    expect(JSON.stringify(projections)).not.toMatch(/native-session|nses_|\/Users\//)

    transport.removeNativeSession('native-session-2')
    await adapter.session({ operation: 'list' })
    expect(projections.at(-1)).toMatchObject({
      model: { externalSessionId: 'ses_01JBBCDEF0123456789ABCDEFG', state: 'removed' },
    })
  })

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

  test('bounds post-create discovery publication and closes the native session', async () => {
    const { adapter, registry, transport } = fixture({ hangPublish: true, requestTimeoutMs: 10 })

    await expect(
      adapter.session({ operation: 'create', idempotencyKey: 'session:create:hanging-publish' })
    ).rejects.toMatchObject({ code: 'ACP_REQUEST_TIMEOUT', classification: 'timeout' })
    await delay(30)
    expect(transport.calls().map(({ method }) => method)).toContain('session/close')
    expect(await registry.get('ses_01JABCDEF0123456789ABCDEFG')).toMatchObject({
      state: 'closed',
    })
  })

  test('bounds non-create external-session callbacks', async () => {
    const { adapter } = fixture({ hangAuthorize: true, requestTimeoutMs: 10 })

    await expect(adapter.session({ operation: 'list' })).rejects.toMatchObject({
      code: 'ACP_REQUEST_TIMEOUT',
      classification: 'timeout',
    })
  })

  test('does not create a session after late authorization crosses the deadline', async () => {
    const { adapter, transport } = fixture({ authorizeDelayMs: 25, requestTimeoutMs: 10 })

    await expect(
      adapter.session({ operation: 'create', idempotencyKey: 'session:create:late-auth' })
    ).rejects.toMatchObject({ code: 'ACP_REQUEST_TIMEOUT', classification: 'timeout' })
    await delay(40)
    expect(transport.calls().map(({ method }) => method)).not.toContain('session/new')
  })

  test('compensates an active registry write completed after timeout', async () => {
    const { adapter, registry } = fixture({ findDelayMs: 25, requestTimeoutMs: 10 })

    await expect(
      adapter.session({ operation: 'create', idempotencyKey: 'session:create:late-registry' })
    ).rejects.toMatchObject({ code: 'ACP_REQUEST_TIMEOUT', classification: 'timeout' })
    await waitForExpectation(async () => {
      expect(await registry.get('ses_01JABCDEF0123456789ABCDEFG')).toMatchObject({
        state: 'closed',
      })
    })
  })

  test('keeps a durable repair record for registry writes that outlive early retries', async () => {
    const { adapter, registry } = fixture({ firstFindDelayMs: 250, requestTimeoutMs: 10 })

    await expect(
      adapter.session({ operation: 'create', idempotencyKey: 'session:create:very-late-registry' })
    ).rejects.toMatchObject({ code: 'ACP_REQUEST_TIMEOUT', classification: 'timeout' })
    await waitForExpectation(async () => {
      expect(await registry.get('ses_01JABCDEF0123456789ABCDEFG')).toMatchObject({
        state: 'closed',
      })
    })
  })

  test('publishes a closed correction after a late active projection', async () => {
    const { adapter, projections, registry } = fixture({
      publishDelayMs: 25,
      requestTimeoutMs: 10,
    })

    await expect(
      adapter.session({ operation: 'create', idempotencyKey: 'session:create:late-publish' })
    ).rejects.toMatchObject({ code: 'ACP_REQUEST_TIMEOUT', classification: 'timeout' })
    await waitForExpectation(async () => {
      expect(await registry.get('ses_01JABCDEF0123456789ABCDEFG')).toMatchObject({
        state: 'closed',
      })
      expect(projections.at(-1)).toMatchObject({ model: { state: 'closed' } })
    })
  })

  test('does not let late compensation close a newer reused native session', async () => {
    const { adapter, projections, registry, setPublishDelay } = fixture({
      publishDelayMs: 25,
      requestTimeoutMs: 10,
    })

    await expect(
      adapter.session({ operation: 'create', idempotencyKey: 'session:create:generation-one' })
    ).rejects.toMatchObject({ classification: 'timeout' })
    setPublishDelay(0)
    const created = await adapter.session({
      operation: 'create',
      idempotencyKey: 'session:create:generation-two',
    })
    expect(created).toMatchObject({ session: { state: 'active' } })
    await adapter.session({
      operation: 'close',
      sessionId: created.session.sessionId,
      idempotencyKey: 'session:close:generation-two',
    })
    await waitForExpectation(async () => {
      expect(await registry.get('ses_01JABCDEF0123456789ABCDEFG')).toMatchObject({
        state: 'closed',
      })
      expect(projections.at(-1)).toMatchObject({ model: { state: 'closed' } })
    })
  })
})

async function waitForExpectation(assertion, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      await assertion()
      return
    } catch (error) {
      lastError = error
      await delay(20)
    }
  }
  throw lastError
}

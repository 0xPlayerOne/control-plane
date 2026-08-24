import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import {
  createRuntimeFabricAcceptanceHarness,
  runtimeFabricIds,
} from './support/runtime-fabric-acceptance.mjs'

describe('M4 runtime fabric acceptance', () => {
  test('publishes one adapter-neutral acceptance command reusable by concrete adapters', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    const support = await readFile(
      new URL('./support/runtime-fabric-acceptance.mjs', import.meta.url),
      'utf8'
    )

    expect(manifest.scripts['test:m4-acceptance']).toBe(
      'bun --cwd=apps/control-api run build && bun test tests/m4-runtime-fabric.test.mjs'
    )
    expect(manifest.devDependencies['@control-plane/runtime-sdk']).toBe('workspace:*')
    for (const prohibitedImport of [
      '@control-plane/runtime-gateway',
      '@mariozechner/pi-coding-agent',
      'agent-client-protocol',
    ]) {
      expect(support).not.toContain(prohibitedImport)
    }
  })

  test('inventories multiple adapter-neutral runtimes per node and separates node/runtime health', async () => {
    const harness = await createRuntimeFabricAcceptanceHarness()
    const localConnections = await harness.registry.listByRuntimeNode(runtimeFabricIds.node)

    expect(localConnections.map(({ runtimeConnectionId }) => runtimeConnectionId)).toEqual([
      runtimeFabricIds.local,
      runtimeFabricIds.unhealthy,
    ])
    expect(new Set(localConnections.map(({ runtimeNodeRefId }) => runtimeNodeRefId))).toEqual(
      new Set([runtimeFabricIds.node])
    )

    const model = harness.readModel(harness.connections.unhealthy, {
      requiredCapabilities: ['stream.output'],
    })
    expect(model).toMatchObject({
      node: { health: 'online' },
      connection: { health: 'unavailable', availability: 'offline' },
      eligibility: { state: 'ineligible' },
    })
    expect(model.eligibility.reasons).toContain('RUNTIME_OFFLINE')
    expect(JSON.stringify(model)).not.toContain('opaqueNativeRef')
    expect(JSON.stringify(model)).not.toContain('/Users/')
  })

  test('routes managed-cloud and local candidates deterministically with explainable degradation', async () => {
    const harness = await createRuntimeFabricAcceptanceHarness()
    const first = harness.route([harness.connections.cloud, harness.connections.local])
    const reordered = harness.route([harness.connections.local, harness.connections.cloud])

    expect(first.audit).toEqual(reordered.audit)
    expect(first.selected.runtimeConnectionId).toBe(runtimeFabricIds.local)
    expect(first.ranked.map(({ runtimeConnectionId }) => runtimeConnectionId)).toEqual([
      runtimeFabricIds.local,
      runtimeFabricIds.cloud,
    ])
    expect(first.ranked[0]).toMatchObject({
      eligibilityMode: 'degraded',
      reasons: expect.arrayContaining([expect.objectContaining({ code: 'LOCALITY' })]),
    })
    expect(harness.eligibility.missing.reasons).toContainEqual({
      code: 'REQUIRED_CAPABILITY_MISSING',
      capability: 'tool.call',
    })
    expect(harness.eligibility.local.degradations).toContainEqual({
      code: 'OPTIONAL_CAPABILITY_MISSING',
      capability: 'session.history',
    })
  })

  test('never lets explicit preference override policy or security and breaks eligible ties by ID', async () => {
    const harness = await createRuntimeFabricAcceptanceHarness()
    const preferredDenied = harness.route([harness.connections.local, harness.connections.denied], {
      runtimeConnectionId: runtimeFabricIds.denied,
    })
    const tie = harness.routeTied([harness.connections.cloud, harness.connections.local])
    const reversedTie = harness.routeTied([harness.connections.local, harness.connections.cloud])

    expect(preferredDenied.outcome).toBe('preference_unavailable')
    expect(preferredDenied.selected.runtimeConnectionId).toBe(runtimeFabricIds.local)
    expect(preferredDenied.excluded).toContainEqual({
      runtimeConnectionId: runtimeFabricIds.denied,
      eligibilityReasons: ['RUNTIME_CONNECTION_POLICY_DENIED', 'SECURITY_POLICY_DENIED'],
    })
    expect(tie.selected.runtimeConnectionId).toBe(runtimeFabricIds.local)
    expect(reversedTie.audit.decisionDigest).toBe(tie.audit.decisionDigest)
  })

  test('makes stale inventory and session capability changes explicit without implying history', async () => {
    const harness = await createRuntimeFabricAcceptanceHarness()
    const staleModel = harness.readModel(harness.connections.stale, {
      requiredCapabilities: ['session.resume'],
    })
    const session = await harness.registerSession()
    const active = harness.assessSession(session, harness.connections.local)
    const changed = harness.assessSession(session, harness.connections.changed)
    const sessionModel = harness.sessionReadModel(session, changed)
    const received = await harness.fetchAgentHqReadModels(staleModel, sessionModel)

    expect(staleModel).toMatchObject({
      freshness: { state: 'stale' },
      eligibility: {
        state: 'ineligible',
        reasons: expect.arrayContaining(['RUNTIME_STALE']),
      },
    })
    expect(active.operations).toMatchObject({
      resume: { available: true },
      history: { available: false, reason: 'CAPABILITY_NOT_ADVERTISED' },
    })
    expect(changed).toMatchObject({
      state: 'capability_changed',
      operations: {
        resume: { available: false, reason: 'CAPABILITY_NO_LONGER_ADVERTISED' },
      },
    })
    expect(received.runtime.statusCode).toBe(200)
    expect(received.session.statusCode).toBe(200)
    expect(received.runtime.body.data.runtimeConnections).toEqual([staleModel])
    expect(received.session.body.data.externalSessions).toEqual([sessionModel])
    expect(JSON.stringify(received)).not.toContain('super-secret-native-token')
    expect(JSON.stringify(sessionModel)).not.toContain('opaqueNativeSessionId')
    expect(JSON.stringify(sessionModel)).not.toContain('ownership')
  })

  test('retains the immutable routed attempt after its runtime disappears', async () => {
    const harness = await createRuntimeFabricAcceptanceHarness()
    const decision = harness.route([harness.connections.local, harness.connections.cloud])
    const attempt = await harness.recordAttempt(decision)
    await harness.disconnectSelected(decision.selected.runtimeConnectionId)
    const retained = await harness.executionRepository.getAttempt(attempt.attemptId)

    expect(await harness.registry.get(decision.selected.runtimeConnectionId)).toMatchObject({
      status: 'disconnected',
      health: 'unavailable',
    })
    expect(retained).toEqual(attempt)
    expect(retained.runtime).toMatchObject({
      runtimeConnectionId: decision.selected.runtimeConnectionId,
      routingDecision: {
        decisionDigest: decision.audit.decisionDigest,
        selectedRank: 1,
      },
    })
  })
})

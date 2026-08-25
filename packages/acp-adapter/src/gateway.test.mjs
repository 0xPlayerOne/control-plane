import { describe, expect, test } from 'bun:test'
import { executionConstraintFixtures } from '@control-plane/domain'
import { RuntimeCompatibilityMatrixSchema } from '@control-plane/runtime-sdk'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import { AcpAdapter } from './index.ts'
import { AcpGatewayClient, ReferenceAcpDriver, ReferenceAcpGatewayTransport } from './gateway.ts'

const now = '2026-08-25T12:00:00.000Z'
const digest = (character) => `sha256:${character.repeat(64)}`
const ids = {
  workspaceId: 'wsp_01JABCDEF0123456789ABCDEFG',
  nodeId: 'rnr_01JABCDEF0123456789ABCDEFG',
  runtimeConnectionId: 'rtc_01JABCDEF0123456789ABCDEFG',
  executionId: 'exe_01JABCDEF0123456789ABCDEFG',
  attemptId: 'att_01JABCDEF0123456789ABCDEFG',
  traceId: 'trc_01JABCDEF0123456789ABCDEFG',
  runtimeOpaqueRef: 'nref_01JABCDEF0123456789ABCDEFG',
}
const matrixUrl = new URL(
  '../../../docs/runtime-compatibility/runtime-certifications.v1.json',
  import.meta.url
)

function plan() {
  return {
    schemaVersion: 1,
    executionPlanId: 'pln_01JABCDEF0123456789ABCDEFG',
    contentDigest: digest('a'),
    profile: {
      profileId: 'prf_01JABCDEF0123456789ABCDEFG',
      profileVersionId: 'pfv_01JABCDEF0123456789ABCDEFG',
      version: 3,
      revision: 2,
      schemaVersion: 1,
      contentDigest: digest('b'),
    },
    skills: [],
    contextPackage: {
      contextPackageId: 'ctx_01JABCDEF0123456789ABCDEFG',
      contentDigest: digest('d'),
      schemaVersion: 1,
      compilerVersion: '1.0.0',
    },
    runtimeRequirements: [
      { capability: 'stream.output', necessity: 'required', minimumSupport: 'supported' },
      { capability: 'execution.cancel', necessity: 'required', minimumSupport: 'supported' },
    ],
    constraints: globalThis.structuredClone(executionConstraintFixtures.write),
    policySnapshot: globalThis.structuredClone(executionConstraintFixtures.write.policySnapshot),
    outputContract: { contractRef: 'contract://execution-result/v1' },
  }
}

function fixture(options = {}) {
  const driver = new ReferenceAcpDriver({
    now: () => now,
    scenario: options.scenario ?? 'complete',
    protocolVersion: options.acpProtocolVersion,
    nativeSessions: [{ sessionId: 'native-session-1', title: 'Gateway session' }],
    sessionReplay: true,
  })
  driver.setGrantState('grant:project-0001', options.grantState ?? 'granted')
  const transport = new ReferenceAcpGatewayTransport({
    driver,
    now: () => now,
    ...ids,
    includeDriver: options.includeDriver,
    gatewayProtocolVersion: options.gatewayProtocolVersion,
    capabilities: options.capabilities,
  })
  const commandIds = new Map()
  let commandIndex = 0
  const client = new AcpGatewayClient({
    transport,
    ...ids,
    localProjectGrantRef: 'grant:project-0001',
    now: () => new Date(now),
    commandId: (identity) => {
      if (!commandIds.has(identity)) {
        const suffix = '01JABCDEF0123456789ABCDEFGHJKMNPQ'.slice(commandIndex, commandIndex + 26)
        commandIds.set(identity, `cmd_${suffix.padEnd(26, 'A')}`)
        commandIndex += 1
      }
      return commandIds.get(identity)
    },
  })
  const externalIds = new Map([
    ['nses_01JABCDEF0123456789ABCDEFG', 'ses_01JABCDEF0123456789ABCDEFG'],
  ])
  return {
    driver,
    transport,
    client,
    adapter: new AcpAdapter({
      transport: client,
      adapterVersion: '1.0.0',
      externalSessionId: (sessionRef) => externalIds.get(sessionRef),
      interactionId: () => 'int_01JABCDEF0123456789ABCDEFG',
      now: () => new Date(now),
    }),
  }
}

describe('local ACP through Runtime Gateway', () => {
  test('matches the exact supported compatibility certification capability claim', async () => {
    const { adapter, transport } = fixture()
    const inspection = await adapter.inspect()
    const inventory = await transport.inventory()
    const matrix = RuntimeCompatibilityMatrixSchema.parse(
      JSON.parse(await readFile(matrixUrl, 'utf8'))
    )
    const certification = matrix.certifications.find(
      ({ certificationId }) => certificationId === 'acp-reference-1-0-0'
    )

    expect(certification).toMatchObject({
      classification: 'supported',
      versions: {
        adapter: inspection.metadata.adapterVersion,
        driver: inspection.metadata.driverVersion,
        harness: inspection.metadata.harnessVersion,
        protocol: `${inventory.protocolVersion.major}.${inventory.protocolVersion.minor}.0`,
      },
    })
    expect(certification.verifiedCapabilities).toEqual(
      inspection.capabilities.map(({ name }) => name).sort()
    )
  })

  test('executes a disposable ACP harness through the generic RuntimeAdapter path', async () => {
    const { adapter, driver, transport } = fixture()
    const nativeBefore = driver.nativeState()

    expect(await adapter.inspect(plan().runtimeRequirements)).toMatchObject({
      health: 'healthy',
      metadata: {
        adapterVersion: '1.0.0',
        driverVersion: '1.0.0',
        harnessVersion: '2.4.0',
      },
      capabilityEvaluation: { eligible: true },
    })
    const handle = await adapter.start({
      attemptId: ids.attemptId,
      idempotencyKey: 'acp:gateway:start',
      executionPlan: plan(),
    })
    const progress = []
    for await (const event of adapter.progress(handle)) progress.push(event)

    expect(progress.map(({ type }) => type)).toEqual([
      'status',
      'output',
      'interaction',
      'usage',
      'artifact',
      'status',
    ])
    expect(await adapter.status(handle)).toMatchObject({ state: 'completed' })
    expect(transport.commands().map(({ operation }) => operation)).toEqual([
      'runtime.status',
      'runtime.session',
      'runtime.execute',
      'runtime.status',
    ])
    expect(transport.commands()[2]).toMatchObject({
      nodeId: ids.nodeId,
      workspaceId: ids.workspaceId,
      runtimeConnectionId: ids.runtimeConnectionId,
      attemptId: ids.attemptId,
      payload: { parameters: { grantRef: 'grant:project-0001' } },
    })
    expect(JSON.stringify(transport.commands())).not.toMatch(
      /native-session|\/Users\/|credential|apiKey|accessToken|privateKey|nativeConfig/
    )
    expect(driver.nativeState()).toEqual(nativeBefore)
  })

  test('reconnects with duplicate-effect protection and routes approval and cancellation', async () => {
    const { adapter, driver, transport } = fixture({ scenario: 'running' })
    const handle = await adapter.start({
      attemptId: ids.attemptId,
      idempotencyKey: 'acp:gateway:reconnect',
      executionPlan: plan(),
    })
    for await (const event of adapter.progress(handle)) {
      if (event.type === 'interaction') break
    }
    await adapter.submitApproval(handle, {
      interactionId: 'int_01JABCDEF0123456789ABCDEFG',
      idempotencyKey: 'acp:gateway:approval',
      decision: 'approve',
    })
    expect(
      await adapter.cancel(handle, {
        idempotencyKey: 'acp:gateway:cancel',
        requestedAt: now,
      })
    ).toMatchObject({ state: 'cancelled' })
    const execute = transport.commands().find(({ operation }) => operation === 'runtime.execute')

    transport.disconnect()
    expect((await adapter.inspect()).health).toBe('unavailable')
    transport.connect()
    expect((await transport.redeliver(execute.commandId)).ack.disposition).toBe('replayed')
    expect(driver.effectCount(ids.attemptId, 'runtime.execute')).toBe(1)
    expect(await adapter.reconcile(handle)).toMatchObject({ state: 'cancelled' })
  })

  test('routes session listing, resume, and replay without exposing native IDs', async () => {
    const { adapter, transport } = fixture()
    const listed = await adapter.session({ operation: 'list' })
    const sessionId = listed.sessions[0].sessionId
    await adapter.session({ operation: 'resume', sessionId, idempotencyKey: 'resume:gateway' })
    const history = await adapter.session({ operation: 'history', sessionId })

    expect(history).toMatchObject({ operation: 'history', completeness: 'complete' })
    expect(
      transport.commands().filter(({ operation }) => operation === 'runtime.session')
    ).toHaveLength(3)
    expect(JSON.stringify(transport.commands())).not.toContain('native-session-1')
  })

  test('fails closed for gateway/ACP mismatch, missing driver, and grant denial', async () => {
    const gatewayMismatch = fixture({ gatewayProtocolVersion: { major: 2, minor: 0 } })
    expect(await gatewayMismatch.adapter.inspect(plan().runtimeRequirements)).toMatchObject({
      health: 'unavailable',
      limitations: expect.arrayContaining(['RUNTIME_GATEWAY_PROTOCOL_UNSUPPORTED']),
    })

    const acpMismatch = fixture({ acpProtocolVersion: 1 })
    expect(await acpMismatch.adapter.inspect(plan().runtimeRequirements)).toMatchObject({
      health: 'unavailable',
      limitations: expect.arrayContaining(['ACP_PROTOCOL_VERSION_UNSUPPORTED:1']),
    })

    const missing = fixture({ includeDriver: false })
    expect(await missing.adapter.inspect()).toMatchObject({
      health: 'unavailable',
      limitations: expect.arrayContaining(['ACP_DRIVER_MISSING']),
    })

    const denied = fixture({ grantState: 'revoked' })
    expect(await denied.adapter.inspect(plan().runtimeRequirements)).toMatchObject({
      health: 'unavailable',
      limitations: expect.arrayContaining(['LOCAL_PROJECT_GRANT_REVOKED']),
    })
    await expect(
      denied.adapter.start({
        attemptId: ids.attemptId,
        idempotencyKey: 'acp:gateway:denied',
        executionPlan: plan(),
      })
    ).rejects.toMatchObject({ code: 'ACP_RUNTIME_INELIGIBLE' })
    expect(denied.transport.commands()).toHaveLength(1)
  })

  test('makes the runtime ineligible when a required capability is not reported', async () => {
    const unsupported = fixture({
      capabilities: [
        'stream.events',
        'tool.call',
        'execution.cancel',
        'interaction.user-input',
        'interaction.approval',
        'session.create',
        'session.list',
        'session.resume',
        'session.close',
        'session.history',
        'session.load',
      ],
    })

    expect(await unsupported.adapter.inspect(plan().runtimeRequirements)).toMatchObject({
      capabilityEvaluation: {
        eligible: false,
        missingRequired: ['stream.output'],
      },
    })
    await expect(
      unsupported.adapter.start({
        attemptId: ids.attemptId,
        idempotencyKey: 'acp:gateway:unsupported',
        executionPlan: plan(),
      })
    ).rejects.toMatchObject({ code: 'ACP_RUNTIME_INELIGIBLE' })
    expect(unsupported.transport.commands()).toHaveLength(1)
  })

  test('normalizes ACP timeout and disappeared runtime without retrying the attempt', async () => {
    const timeout = fixture({ scenario: 'timeout' })
    const handle = await timeout.adapter.start({
      attemptId: ids.attemptId,
      idempotencyKey: 'acp:gateway:timeout',
      executionPlan: plan(),
    })
    expect(await timeout.adapter.status(handle)).toMatchObject({
      state: 'timed_out',
      error: { code: 'ACP_PROMPT_TIMED_OUT', retryable: true },
    })
    expect(timeout.driver.effectCount(ids.attemptId, 'runtime.execute')).toBe(1)

    const disappeared = fixture({ scenario: 'running' })
    const active = await disappeared.adapter.start({
      attemptId: ids.attemptId,
      idempotencyKey: 'acp:gateway:disappeared',
      executionPlan: plan(),
    })
    disappeared.transport.removeDriver()
    expect(await disappeared.adapter.reconcile(active)).toMatchObject({ state: 'unknown' })
  })
})

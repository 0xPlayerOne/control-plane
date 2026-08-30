import { describe, expect, test } from 'bun:test'
import { executionConstraintFixtures } from '@control-plane/domain'
import {
  DirectLocalRuntimeTransport,
  runRuntimeAdapterConformance,
} from '@control-plane/runtime-sdk'
import { AcpAdapter, AcpDriver, ReferenceAcpTransport } from './index.ts'

const now = '2026-08-25T12:00:00.000Z'
const digest = (character) => `sha256:${character.repeat(64)}`
const attemptId = 'att_01JABCDEF0123456789ABCDEFG'

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
  const transport = new ReferenceAcpTransport({ now: () => now, ...options })
  const nativeSessions = new Map()
  const adapter = new AcpAdapter({
    transport: new DirectLocalRuntimeTransport(
      new AcpDriver({
        transport,
        adapterVersion: '1.0.0',
        externalSessionId: (nativeSessionId) => {
          if (!nativeSessions.has(nativeSessionId)) {
            nativeSessions.set(nativeSessionId, 'ses_01JABCDEF0123456789ABCDEFG')
          }
          return nativeSessions.get(nativeSessionId)
        },
        interactionId: () => 'int_01JABCDEF0123456789ABCDEFG',
        now: () => new Date(now),
      })
    ),
  })
  return { adapter, transport }
}

describe('ACP RuntimeAdapter', () => {
  test('negotiates ACP v2 capabilities without fabricating optional behavior', async () => {
    const { adapter, transport } = fixture()
    const inspection = await adapter.inspect([
      { capability: 'stream.output', necessity: 'required' },
      { capability: 'session.history', necessity: 'optional', minimumSupport: 'degraded' },
      { capability: 'session.load', necessity: 'required', minimumSupport: 'degraded' },
    ])

    expect(inspection).toMatchObject({
      health: 'healthy',
      metadata: {
        adapterName: 'acp',
        runtimeFamily: 'acp',
        harnessVersion: '2.4.0',
        transportKind: 'direct-local',
      },
      capabilityEvaluation: {
        eligible: false,
        missingRequired: ['session.load'],
        missingOptional: ['session.history'],
      },
    })
    expect(inspection.capabilities.map(({ name }) => name)).toEqual([
      'execution.cancel',
      'interaction.approval',
      'session.close',
      'session.create',
      'session.list',
      'session.resume',
      'stream.events',
      'stream.output',
      'tool.call',
    ])
    expect(transport.calls()[0]).toMatchObject({
      method: 'initialize',
      params: { protocolVersion: 2, capabilities: {} },
    })
  })

  test('executes and normalizes ACP updates while leaving native auth and configuration alone', async () => {
    const { adapter, transport } = fixture({ scenario: 'complete' })
    const handle = await adapter.start({
      attemptId,
      idempotencyKey: 'acp:start',
      executionPlan: plan(),
    })
    const progress = []
    for await (const event of adapter.progress(handle)) progress.push(event)

    expect(handle).toMatchObject({
      handleId: `acp:${attemptId}`,
      externalSessionId: 'ses_01JABCDEF0123456789ABCDEFG',
    })
    expect(progress.map(({ type }) => type)).toEqual([
      'status',
      'output',
      'interaction',
      'usage',
      'artifact',
      'status',
    ])
    expect(await adapter.status(handle)).toMatchObject({
      state: 'completed',
      result: {
        output: { text: 'ACP complete' },
        artifacts: [{ locator: 'artifact://acp/result' }],
      },
    })
    expect(transport.calls().map(({ method }) => method)).toEqual([
      'initialize',
      'session/new',
      'session/prompt',
    ])
    expect(transport.calls()[1].params).toEqual({})
    expect(JSON.stringify(transport.calls())).not.toMatch(
      /auth\/login|auth\/logout|config|mcpServers|cwd|\/Users\/|credential|apiKey|accessToken/
    )
  })

  test('maps permission decisions and cancellation to ACP operations', async () => {
    const { adapter, transport } = fixture({ scenario: 'running' })
    const handle = await adapter.start({
      attemptId,
      idempotencyKey: 'acp:controls',
      executionPlan: plan(),
    })
    for await (const event of adapter.progress(handle)) {
      if (event.type === 'interaction') break
    }
    await adapter.submitApproval(handle, {
      interactionId: 'int_01JABCDEF0123456789ABCDEFG',
      idempotencyKey: 'acp:approval',
      decision: 'approve',
    })
    expect(
      await adapter.cancel(handle, { idempotencyKey: 'acp:cancel', requestedAt: now })
    ).toMatchObject({ state: 'cancelled' })

    expect(transport.responses()).toEqual([
      { requestId: 40, result: { outcome: { outcome: 'selected', optionId: 'allow_once' } } },
    ])
    expect(transport.calls().at(-1)).toMatchObject({
      method: 'session/cancel',
      params: { sessionId: 'native-session-1' },
    })
  })

  test('passes shared RuntimeAdapter conformance with ACP-native state retained behind the edge', async () => {
    const { adapter, transport } = fixture({ scenario: 'running' })
    const report = await runRuntimeAdapterConformance({
      adapter,
      executionPlan: plan(),
      attemptId,
      complete: async (handle) => {
        transport.completeAttempt(handle.attemptId)
        return adapter.status(handle)
      },
    })

    expect(report.passed).toBeTrue()
    expect(transport.effectCount(attemptId)).toBe(1)
  })

  test('fails closed on protocol mismatch and reports disconnect without changing native state', async () => {
    const mismatch = fixture({ protocolVersion: 1 })
    expect(await mismatch.adapter.inspect(plan().runtimeRequirements)).toMatchObject({
      health: 'unavailable',
      limitations: expect.arrayContaining(['ACP_PROTOCOL_VERSION_UNSUPPORTED:1']),
      capabilityEvaluation: { eligible: false },
    })
    await expect(
      mismatch.adapter.start({
        attemptId,
        idempotencyKey: 'acp:mismatch',
        executionPlan: plan(),
      })
    ).rejects.toMatchObject({ code: 'ACP_RUNTIME_INELIGIBLE' })

    const disconnected = fixture({ scenario: 'running' })
    const handle = await disconnected.adapter.start({
      attemptId,
      idempotencyKey: 'acp:disconnect',
      executionPlan: plan(),
    })
    disconnected.transport.disconnect()
    expect(await disconnected.adapter.inspect()).toMatchObject({
      health: 'unavailable',
      limitations: expect.arrayContaining(['ACP_DISCONNECTED']),
    })
    expect(await disconnected.adapter.reconcile(handle)).toMatchObject({ state: 'unknown' })
  })

  test('normalizes ACP timeout without inventing an automatic retry', async () => {
    const { adapter, transport } = fixture({ scenario: 'timeout' })
    const handle = await adapter.start({
      attemptId,
      idempotencyKey: 'acp:timeout',
      executionPlan: plan(),
    })

    expect(await adapter.status(handle)).toMatchObject({
      state: 'timed_out',
      error: { code: 'ACP_PROMPT_TIMED_OUT', classification: 'timeout', retryable: true },
    })
    expect(transport.effectCount(attemptId)).toBe(1)
  })
})

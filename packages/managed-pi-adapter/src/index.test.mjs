import { describe, expect, test } from 'bun:test'
import { executionConstraintFixtures } from '@control-plane/domain'
import { runRuntimeAdapterConformance } from '@control-plane/runtime-sdk'
import {
  ManagedPiAdapter,
  ManagedPiConfigurationSchema,
  translateExecutionPlanToManagedPi,
} from './index.ts'

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
    skills: [
      {
        skillId: 'skl_01JABCDEF0123456789ABCDEFG',
        skillVersionId: 'skv_01JABCDEF0123456789ABCDEFG',
        revision: 4,
        schemaVersion: 1,
        semanticVersion: '2.1.0',
        contentDigest: digest('c'),
      },
    ],
    contextPackage: {
      contextPackageId: 'ctx_01JABCDEF0123456789ABCDEFG',
      contentDigest: digest('d'),
      schemaVersion: 1,
      compilerVersion: '1.0.0',
    },
    runtimeRequirements: [
      { capability: 'stream.output', necessity: 'required', minimumSupport: 'supported' },
      { capability: 'session.history', necessity: 'optional', minimumSupport: 'degraded' },
    ],
    constraints: globalThis.structuredClone(executionConstraintFixtures.write),
    policySnapshot: globalThis.structuredClone(executionConstraintFixtures.write.policySnapshot),
    outputContract: { contractRef: 'contract://execution-result/v1' },
  }
}

class RecordingManagedPiClient {
  starts = []
  executions = new Map()

  async inspect() {
    return {
      driverVersion: '1.0.0',
      runtimeVersion: '0.52.1',
      protocolVersion: '1.0.0',
      health: 'healthy',
      capabilities: [
        { name: 'stream.output', support: 'supported' },
        { name: 'execution.cancel', support: 'supported' },
        { name: 'interaction.user-input', support: 'supported' },
        { name: 'interaction.approval', support: 'supported' },
      ],
      limitations: [],
      observedAt: now,
    }
  }

  async start(command) {
    this.starts.push(globalThis.structuredClone(command))
    const handle = {
      handleId: `managed-pi:${command.attemptId}`,
      attemptId: command.attemptId,
      startedAt: now,
    }
    this.executions.set(handle.handleId, {
      handle,
      state: 'running',
      events: [
        { sequence: 1, occurredAt: now, kind: 'status', state: 'running' },
        { sequence: 2, occurredAt: now, kind: 'output', text: 'working' },
        {
          sequence: 3,
          occurredAt: now,
          kind: 'tool_request',
          interactionId: 'int_01JABCDEF0123456789ABCDEFG',
          toolId: 'project-files',
          operation: 'read',
        },
        {
          sequence: 4,
          occurredAt: now,
          kind: 'usage',
          inputTokens: 10,
          outputTokens: 2,
          durationMs: 100,
        },
      ],
    })
    return handle
  }

  async *progress(handle, afterSequence = 0) {
    for (const event of this.executions.get(handle.handleId).events) {
      if (event.sequence > afterSequence) yield event
    }
  }

  async submitInput(handle) {
    return this.status(handle)
  }

  async submitApproval(handle) {
    return this.status(handle)
  }

  async cancel(handle, request) {
    const execution = this.executions.get(handle.handleId)
    execution.state = 'cancelled'
    execution.observedAt = request.requestedAt
    return this.status(handle)
  }

  async status(handle) {
    const execution = this.executions.get(handle.handleId)
    return {
      state: execution.state,
      observedAt: execution.observedAt ?? now,
      ...(execution.result ? { result: execution.result } : {}),
      ...(execution.error ? { error: execution.error } : {}),
    }
  }

  async reconcile(handle) {
    return this.status(handle)
  }

  async session() {
    throw new Error('not implemented by fixture')
  }

  async cleanup(handle) {
    this.executions.delete(handle.handleId)
  }

  complete(handle) {
    const execution = this.executions.get(handle.handleId)
    execution.state = 'succeeded'
    execution.result = {
      output: { ok: true },
      usage: { inputTokens: 10, outputTokens: 2, durationMs: 100 },
      artifacts: [],
    }
  }
}

describe('ManagedPiAdapter plan translation', () => {
  test('deterministically pins profile, skills, context, policy, tools, models, limits, and output', () => {
    const firstPlan = plan()
    const reordered = globalThis.structuredClone(firstPlan)
    reordered.runtimeRequirements.reverse()
    reordered.constraints.runtime.requiredCapabilities.reverse()
    reordered.constraints.models[0].requiredCapabilities.reverse()
    reordered.constraints.models[0].providerPolicy.allowedClasses.reverse()
    reordered.constraints.tools.grants[0].operations.reverse()

    const first = translateExecutionPlanToManagedPi(firstPlan, '1.0.0')
    const second = translateExecutionPlanToManagedPi(reordered, '1.0.0')

    expect(ManagedPiConfigurationSchema.parse(first)).toEqual(second)
    expect(first).toMatchObject({
      adapterVersion: '1.0.0',
      executionPlanId: firstPlan.executionPlanId,
      profile: { profileVersionId: firstPlan.profile.profileVersionId },
      contextPackage: { contextPackageId: firstPlan.contextPackage.contextPackageId },
      interactionPolicy: firstPlan.constraints.interaction,
      limits: firstPlan.constraints.limits,
      outputContract: firstPlan.outputContract,
    })
  })
})

describe('ManagedPiAdapter normalization', () => {
  test('maps capabilities explicitly and normalizes Pi progress and provenance', async () => {
    const client = new RecordingManagedPiClient()
    const adapter = new ManagedPiAdapter({ client, adapterVersion: '1.0.0' })
    const inspection = await adapter.inspect([
      { capability: 'stream.output', necessity: 'required' },
      { capability: 'session.history', necessity: 'required', minimumSupport: 'degraded' },
    ])

    expect(inspection.capabilityEvaluation).toMatchObject({
      eligible: false,
      missingRequired: ['session.history'],
    })

    const handle = await adapter.start({
      attemptId,
      idempotencyKey: 'managed-pi:start',
      executionPlan: plan(),
    })
    const progress = []
    for await (const event of adapter.progress(handle)) progress.push(event)

    expect(progress.map((event) => event.type)).toEqual([
      'status',
      'output',
      'interaction',
      'usage',
    ])
    expect(progress[2].data).toEqual({
      interactionId: 'int_01JABCDEF0123456789ABCDEFG',
      kind: 'tool',
      operation: 'read',
      toolId: 'project-files',
    })
    expect(client.starts[0].configuration).toMatchObject({
      adapterVersion: '1.0.0',
      profile: { version: 3, revision: 2 },
      skills: [{ semanticVersion: '2.1.0', revision: 4 }],
    })
  })

  test('passes the shared RuntimeAdapter conformance suite', async () => {
    const client = new RecordingManagedPiClient()
    const adapter = new ManagedPiAdapter({ client, adapterVersion: '1.0.0' })
    const report = await runRuntimeAdapterConformance({
      adapter,
      executionPlan: plan(),
      attemptId,
      complete: async (handle) => {
        client.complete(handle)
        return adapter.status(handle)
      },
    })

    expect(report.passed).toBe(true)
  })

  test('fails closed for an unsupported Pi version and normalizes runtime errors', async () => {
    const client = new RecordingManagedPiClient()
    client.inspect = async () => ({
      driverVersion: '1.0.0',
      runtimeVersion: '0.53.0',
      protocolVersion: '1.0.0',
      health: 'healthy',
      capabilities: [{ name: 'stream.output', support: 'supported' }],
      limitations: [],
      observedAt: now,
    })
    const incompatible = new ManagedPiAdapter({ client, adapterVersion: '1.0.0' })

    expect(await incompatible.inspect(plan().runtimeRequirements)).toMatchObject({
      health: 'unavailable',
      capabilities: [],
      limitations: ['UNSUPPORTED_PI_RUNTIME_VERSION:0.53.0'],
      capabilityEvaluation: { eligible: false, missingRequired: ['stream.output'] },
    })
    await expect(
      incompatible.start({
        attemptId,
        idempotencyKey: 'managed-pi:unsupported',
        executionPlan: plan(),
      })
    ).rejects.toMatchObject({
      code: 'MANAGED_PI_INELIGIBLE',
      classification: 'unsupported',
      retryable: false,
    })

    const runtimeClient = new RecordingManagedPiClient()
    const adapter = new ManagedPiAdapter({ client: runtimeClient, adapterVersion: '1.0.0' })
    const handle = await adapter.start({
      attemptId,
      idempotencyKey: 'managed-pi:error',
      executionPlan: plan(),
    })
    const execution = runtimeClient.executions.get(handle.handleId)
    execution.state = 'errored'
    execution.error = {
      code: 'PI_PROCESS_CRASHED',
      classification: 'runtime',
      message: 'Managed Pi process exited unexpectedly',
      retryable: true,
    }

    expect(await adapter.status(handle)).toMatchObject({
      state: 'failed',
      error: { code: 'PI_PROCESS_CRASHED', classification: 'runtime', retryable: true },
    })
  })
})

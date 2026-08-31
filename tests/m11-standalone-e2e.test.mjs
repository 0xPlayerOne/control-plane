import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, test } from 'bun:test'
import { AcpAdapter, AcpDriver, ReferenceAcpTransport } from '@control-plane/acp-adapter'
import { ControlApiFixtures } from '@control-plane/contracts'
import { createExecutionPlanTestFixture } from '@control-plane/execution-plan/testing'
import { LocalControlPlaneComposition } from '@control-plane/local-control-plane'
import { ManagedPiAdapter, ManagedPiDriver } from '@control-plane/managed-pi-adapter'
import { DirectLocalRuntimeTransport } from '@control-plane/runtime-sdk'

const observedAt = '2026-08-30T12:00:00.000Z'
const workflowId = 'wfl_01JABCDEF0123456789ABCDEFG'

describe('M11 standalone execution composition', () => {
  test.each([
    ['managed-pi', createDirectManagedPiAdapter],
    ['acp', createDirectAcpAdapter],
  ])(
    'runs and recovers %s through Local without a Runtime Gateway',
    async (family, createAdapter) => {
      const directory = await mkdtemp(join(tmpdir(), 'control-plane-m11-local-'))
      const adapter = createAdapter()
      const inspection = await adapter.inspect()
      expect(inspection).toMatchObject({
        health: 'healthy',
        metadata: { transportKind: 'direct-local' },
      })

      const first = composition(directory, adapter)
      let executionId
      let attemptId
      let resultReference
      try {
        await first.start()
        expect(await first.manifest()).toMatchObject({
          profile: 'local',
          topology: { externalServices: 0, runtimeTransport: 'direct-local' },
        })
        const plan = family === 'acp' ? createAcpExecutionPlan() : createExecutionPlanTestFixture()
        await first.executionPlans.put(plan)
        const accepted = await first.commands.acceptExecution(command(plan))
        executionId = accepted.execution.executionId
        attemptId = `att_${executionId.slice(4)}`
        const activities = first.executionLifecycleActivities
        await activities.persistStatus(status(executionId, 'queued'))
        await activities.ensureAttempt({
          executionId,
          workflowId,
          effectKey: `${workflowId}:attempt`,
        })
        await activities.persistStatus(status(executionId, 'starting', attemptId))
        const outcome = await activities.dispatch({
          executionId,
          attemptId,
          executionPlan: plan,
          effectKey: `${workflowId}:dispatch`,
        })
        expect(outcome).toMatchObject({ outcome: 'completed' })
        resultReference = outcome.resultReference
        await activities.persistStatus({
          ...status(executionId, 'completed', attemptId),
          resultReference,
        })
      } finally {
        await first.close()
      }

      const restarted = composition(directory, adapter)
      try {
        await restarted.start()
        expect(await restarted.executions.getExecution(executionId)).toMatchObject({
          state: 'completed',
          latestAttemptId: attemptId,
          terminalResultRef: resultReference,
        })
        expect(await restarted.executions.getAttempt(attemptId)).toMatchObject({
          state: 'completed',
          terminalResultRef: resultReference,
        })
        expect(await restarted.commandRepository.getByExecutionId(executionId)).toMatchObject({
          status: 'completed',
          resultReference,
        })
      } finally {
        await restarted.close()
        await rm(directory, { recursive: true, force: true })
      }
    },
    30_000
  )

  test('accepts and completes one Local execution through the pinned Restate runtime', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'control-plane-m11-restate-'))
    const local = new LocalControlPlaneComposition({
      dataDirectory: directory,
      runtimeTransport: createDirectManagedPiAdapter(),
      workflowEndpointPort: 19080,
    })
    try {
      await local.start()
      const plan = createExecutionPlanTestFixture()
      await local.executionPlans.put(plan)
      const issuedAt = new Date().toISOString()
      const response = await local.executionAcceptanceService.accept(
        {
          ...ControlApiFixtures.executionAcceptance.request,
          requestId: plan.correlation.requestId,
          workspaceId: plan.correlation.workspaceId,
          projectId: plan.correlation.projectId,
          issuedAt,
          payload: {
            taskId: plan.correlation.taskId,
            agentId: plan.correlation.agentId,
            executionPlan: {
              executionPlanId: plan.executionPlanId,
              contentDigest: plan.contentDigest,
              schemaVersion: plan.schemaVersion,
            },
            deadlineAt: new Date(Date.parse(issuedAt) + 60_000).toISOString(),
            retentionExpiresAt: new Date(Date.parse(issuedAt) + 86_400_000).toISOString(),
          },
        },
        'svc_m11-standalone'
      )
      expect(response.data.status).toBe('processing')
      const execution = await waitForTerminalExecution(local, response.data.executionId)
      expect(execution).toMatchObject({
        state: 'completed',
        terminalResultRef: `art_${response.data.executionId.slice(4)}`,
      })
    } finally {
      await local.close()
      await rm(directory, { recursive: true, force: true })
    }
  }, 60_000)
})

async function waitForTerminalExecution(composition, executionId) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const execution = await composition.executions.getExecution(executionId)
    if (['completed', 'failed', 'cancelled', 'timed_out'].includes(execution.state)) {
      return execution
    }
    await delay(100)
  }
  throw new Error('M11_LOCAL_RESTATE_EXECUTION_TIMEOUT')
}

function createAcpExecutionPlan() {
  return createExecutionPlanTestFixture({
    profileCapabilityRequirements: ['stream.output', 'execution.cancel'],
    skillRequiredCapabilities: [],
  })
}

function composition(dataDirectory, runtimeTransport) {
  return new LocalControlPlaneComposition({
    dataDirectory,
    runtimeTransport,
    workflowRuntime: {
      profile: 'local',
      start: async () => undefined,
      health: async () => ({ ready: true, component: 'restate', version: '1.7.7' }),
      stop: async () => undefined,
    },
    endpointFactory: {
      create: async () => ({ run: async () => undefined, shutdown: async () => undefined }),
    },
  })
}

function command(plan) {
  return {
    callerPrincipalId: 'svc_m11-standalone',
    operation: 'execution.accept',
    commandId: 'cmd_01JABCDEF0123456789ABCDEFG',
    requestId: plan.correlation.requestId,
    idempotencyKey: 'm11-standalone-execution',
    payloadHash: 'a'.repeat(64),
    correlation: {
      workspaceId: plan.correlation.workspaceId,
      projectId: plan.correlation.projectId,
      taskId: plan.correlation.taskId,
      agentId: plan.correlation.agentId,
    },
    executionPlan: {
      executionPlanId: plan.executionPlanId,
      contentDigest: plan.contentDigest,
      schemaVersion: plan.schemaVersion,
    },
    receivedAt: observedAt,
    retentionExpiresAt: '2026-09-30T12:00:00.000Z',
  }
}

function status(executionId, state, attemptId) {
  return {
    executionId,
    ...(attemptId === undefined ? {} : { attemptId }),
    state,
    effectKey: `${workflowId}:${state}`,
  }
}

function createDirectManagedPiAdapter() {
  return new ManagedPiAdapter({
    transport: new DirectLocalRuntimeTransport(
      new ManagedPiDriver({ client: new CompletedManagedPiClient(), adapterVersion: '1.0.0' })
    ),
  })
}

function createDirectAcpAdapter() {
  const externalSessions = new Map()
  return new AcpAdapter({
    transport: new DirectLocalRuntimeTransport(
      new AcpDriver({
        transport: new FilesystemCapableAcpTransport({ now: () => observedAt }),
        adapterVersion: '1.0.0',
        externalSessionId: (nativeSessionId) => {
          if (!externalSessions.has(nativeSessionId)) {
            externalSessions.set(nativeSessionId, 'ses_01JABCDEF0123456789ABCDEFG')
          }
          return externalSessions.get(nativeSessionId)
        },
        interactionId: () => 'int_01JABCDEF0123456789ABCDEFG',
        now: () => new Date(observedAt),
      })
    ),
  })
}

class CompletedManagedPiClient {
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
        { name: 'filesystem.read', support: 'supported' },
      ],
      limitations: [],
      observedAt,
    }
  }

  async start(command) {
    const handle = {
      handleId: `managed-pi:${command.attemptId}`,
      attemptId: command.attemptId,
      startedAt: observedAt,
    }
    this.executions.set(handle.handleId, handle)
    return handle
  }

  async *progress() {
    yield { sequence: 1, occurredAt: observedAt, kind: 'status', state: 'running' }
    yield { sequence: 2, occurredAt: observedAt, kind: 'output', text: 'completed' }
    yield {
      sequence: 3,
      occurredAt: observedAt,
      kind: 'usage',
      inputTokens: 3,
      outputTokens: 2,
      durationMs: 10,
    }
    yield { sequence: 4, occurredAt: observedAt, kind: 'status', state: 'succeeded' }
  }

  async status(handle) {
    this.#require(handle)
    return {
      state: 'succeeded',
      observedAt,
      result: {
        output: { ok: true },
        usage: { inputTokens: 3, outputTokens: 2, durationMs: 10 },
        artifacts: [],
      },
    }
  }

  submitInput(handle) {
    return this.status(handle)
  }

  submitApproval(handle) {
    return this.status(handle)
  }

  async cancel(handle, request) {
    this.#require(handle)
    return { state: 'cancelled', observedAt: request.requestedAt }
  }

  reconcile(handle) {
    return this.status(handle)
  }

  async session() {
    throw new Error('CAPABILITY_UNSUPPORTED')
  }

  async cleanup(handle) {
    this.#require(handle)
  }

  #require(handle) {
    if (!this.executions.has(handle.handleId)) throw new Error('MANAGED_PI_EXECUTION_MISSING')
  }
}

class FilesystemCapableAcpTransport extends ReferenceAcpTransport {
  async request(method, params) {
    const result = await super.request(method, params)
    if (method !== 'initialize') return result
    return {
      ...result,
      capabilities: {
        ...result.capabilities,
        _meta: {
          controlPlane: {
            capabilities: [
              'stream.output',
              'execution.cancel',
              'interaction.user-input',
              'interaction.approval',
              'filesystem.read',
            ],
            driverVersion: '1.0.0',
          },
        },
      },
    }
  }
}

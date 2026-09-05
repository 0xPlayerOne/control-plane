import { describe, expect, test } from 'bun:test'
import { InMemoryExecutionRepository, ExecutionLifecycleService } from '@control-plane/domain'
import { InMemoryExecutionPlanRepository } from '@control-plane/execution-plan'
import { createExecutionPlanTestFixture } from '@control-plane/execution-plan/testing'
import { DurableExecutionLifecycleActivities } from './cloud-execution-activities.ts'

const ids = {
  executionId: 'exe_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  attemptId: 'att_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  workflowId: 'wfl_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  resultReference: 'art_01ARZ3NDEKTSV4RRFFQ69G5FAV',
}

describe('durable Cloud execution activities', () => {
  test('freezes the selected remote runtime on the durable attempt before dispatch', async () => {
    const repository = new InMemoryExecutionRepository()
    const lifecycle = new ExecutionLifecycleService(repository)
    const plans = new InMemoryExecutionPlanRepository()
    const plan = executionPlan()
    await plans.put(plan)
    await lifecycle.createExecution({
      executionId: ids.executionId,
      correlation: plan.correlation,
      executionPlan: {
        executionPlanId: plan.executionPlanId,
        contentDigest: plan.contentDigest,
        schemaVersion: plan.schemaVersion,
      },
      acceptedAt: '2026-08-28T12:00:00.000Z',
    })
    const selected = {
      runtimeDefinitionId: 'rtd_01JABCDEF0123456789ABCDEFG',
      runtimeNodeRefId: 'rnr_01JABCDEF0123456789ABCDEFG',
      runtimeConnectionId: 'rtc_01JABCDEF0123456789ABCDEFG',
      routingDecision: {
        routingVersion: 1,
        policy: {
          policyId: 'runtime-routing-v1',
          version: 1,
          digest: `sha256:${'a'.repeat(64)}`,
        },
        evaluatedAt: '2026-08-28T12:00:00.000Z',
        inputDigest: `sha256:${'b'.repeat(64)}`,
        decisionDigest: `sha256:${'c'.repeat(64)}`,
        selectedRank: 1,
        candidateCount: 1,
        reasonCodes: ['RUNTIME_SELECTED'],
      },
    }
    let resolutions = 0
    const activity = activities({
      lifecycle,
      plans,
      runtime: runtimePort(),
      runtimeRouter: {
        resolve: async (input) => {
          resolutions += 1
          expect(input.executionPlan).toEqual(plan)
          expect(input.execution.executionId).toBe(ids.executionId)
          return selected
        },
      },
    })

    await activity.persistStatus(status('queued'))
    await activity.ensureAttempt(attemptInput())
    await activity.ensureAttempt(attemptInput())
    expect(await repository.getAttempt(ids.attemptId)).toMatchObject({ runtime: selected })
    expect(resolutions).toBe(1)
  })

  test('converges lifecycle replay on one attempt and one terminal result across restart', async () => {
    const repository = new InMemoryExecutionRepository()
    const lifecycle = new ExecutionLifecycleService(repository)
    const plans = new InMemoryExecutionPlanRepository()
    const plan = executionPlan()
    await plans.put(plan)
    await lifecycle.createExecution({
      executionId: ids.executionId,
      correlation: plan.correlation,
      executionPlan: {
        executionPlanId: plan.executionPlanId,
        contentDigest: plan.contentDigest,
        schemaVersion: plan.schemaVersion,
      },
      acceptedAt: '2026-08-28T12:00:00.000Z',
      deadlineAt: '2026-08-28T13:00:00.000Z',
    })
    const runtime = runtimePort()
    const first = activities({ lifecycle, plans, runtime })

    await first.persistStatus(status('queued'))
    await expect(first.ensureAttempt(attemptInput())).resolves.toEqual({
      attemptId: ids.attemptId,
    })
    await first.persistStatus(status('starting', true))
    await first.persistStatus(status('running', true))
    await expect(first.dispatch(dispatchInput())).resolves.toEqual({
      outcome: 'completed',
      resultReference: ids.resultReference,
    })

    const restarted = activities({ lifecycle, plans, runtime })
    await expect(restarted.ensureAttempt(attemptInput())).resolves.toEqual({
      attemptId: ids.attemptId,
    })
    await restarted.persistStatus({
      ...status('completed', true),
      resultReference: ids.resultReference,
    })
    await restarted.persistStatus({
      ...status('completed', true),
      resultReference: ids.resultReference,
    })

    const execution = await lifecycle.getExecution(ids.executionId)
    const attempts = await repository.listAttempts(ids.executionId)
    expect(execution).toMatchObject({
      state: 'completed',
      attemptCount: 1,
      latestAttemptId: ids.attemptId,
      terminalResultRef: ids.resultReference,
    })
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({
      attemptId: ids.attemptId,
      state: 'completed',
      terminalResultRef: ids.resultReference,
    })
    expect(runtime.dispatches).toHaveLength(1)
    expect(runtime.dispatches[0].executionPlan).toEqual(plan)
    expect(runtime.commandTransitions).toEqual([
      {
        executionId: ids.executionId,
        to: 'completed',
        transitionedAt: '2026-08-28T12:00:01.000Z',
        resultReference: ids.resultReference,
      },
      {
        executionId: ids.executionId,
        to: 'completed',
        transitionedAt: '2026-08-28T12:00:01.000Z',
        resultReference: ids.resultReference,
      },
    ])
  })

  test('persists normalized failures on both execution and attempt', async () => {
    const repository = new InMemoryExecutionRepository()
    const lifecycle = new ExecutionLifecycleService(repository)
    const plans = new InMemoryExecutionPlanRepository()
    const plan = executionPlan()
    await plans.put(plan)
    await lifecycle.createExecution({
      executionId: ids.executionId,
      correlation: plan.correlation,
      executionPlan: {
        executionPlanId: plan.executionPlanId,
        contentDigest: plan.contentDigest,
        schemaVersion: plan.schemaVersion,
      },
      acceptedAt: '2026-08-28T12:00:00.000Z',
    })
    const activity = activities({ lifecycle, plans, runtime: runtimePort() })
    await activity.persistStatus(status('queued'))
    await activity.ensureAttempt(attemptInput())
    await activity.persistStatus(status('starting', true))
    await activity.persistStatus({
      ...status('failed', true),
      failure: { classification: 'runtime_error', code: 'MANAGED_RUNTIME_FAILED' },
    })

    expect(await lifecycle.getExecution(ids.executionId)).toMatchObject({
      state: 'failed',
      failure: { classification: 'runtime_error', code: 'MANAGED_RUNTIME_FAILED' },
    })
    expect((await repository.listAttempts(ids.executionId))[0]).toMatchObject({
      state: 'failed',
      failure: { classification: 'runtime_error', code: 'MANAGED_RUNTIME_FAILED' },
    })
  })

  test('rejects Cloud completion without a durable result reference', async () => {
    const repository = new InMemoryExecutionRepository()
    const lifecycle = new ExecutionLifecycleService(repository)
    const plans = new InMemoryExecutionPlanRepository()
    const plan = executionPlan()
    await plans.put(plan)
    await lifecycle.createExecution({
      executionId: ids.executionId,
      correlation: plan.correlation,
      executionPlan: {
        executionPlanId: plan.executionPlanId,
        contentDigest: plan.contentDigest,
        schemaVersion: plan.schemaVersion,
      },
      acceptedAt: '2026-08-28T12:00:00.000Z',
    })
    const activity = activities({ lifecycle, plans, runtime: runtimePort() })

    await expect(activity.persistStatus(status('completed'))).rejects.toThrow(
      'WORKFLOW_COMPLETION_RESULT_MISSING'
    )
    expect((await lifecycle.getExecution(ids.executionId)).state).toBe('accepted')
  })
})

function activities({ lifecycle, plans, runtime, runtimeRouter }) {
  return new DurableExecutionLifecycleActivities({
    lifecycle,
    plans,
    runtime,
    graph: {
      runGraphSegment: async () => ({
        outcome: 'failed',
        failureCode: 'GRAPH_DISABLED',
        retryable: false,
      }),
      resumeGraphSegment: async () => ({
        outcome: 'failed',
        failureCode: 'GRAPH_DISABLED',
        retryable: false,
      }),
      continueGraphSegment: async () => ({
        outcome: 'failed',
        failureCode: 'GRAPH_DISABLED',
        retryable: false,
      }),
    },
    commands: {
      transitionExecutionCommand: async (input) => runtime.commandTransitions.push(input),
    },
    ...(runtimeRouter === undefined ? {} : { runtimeRouter }),
    now: () => '2026-08-28T12:00:01.000Z',
  })
}

function runtimePort() {
  const dispatches = []
  const commandTransitions = []
  return {
    dispatches,
    commandTransitions,
    async dispatch(input) {
      dispatches.push(globalThis.structuredClone(input))
      return { outcome: 'completed', resultReference: ids.resultReference }
    },
    async applyInteraction() {
      return { outcome: 'failed', failureCode: 'INTERACTION_UNEXPECTED', retryable: false }
    },
    async cleanup() {},
  }
}

function attemptInput() {
  return {
    executionId: ids.executionId,
    workflowId: ids.workflowId,
    effectKey: `${ids.workflowId}:execution-lifecycle-v1:attempt`,
  }
}

function dispatchInput() {
  const plan = executionPlan()
  return {
    executionId: ids.executionId,
    attemptId: ids.attemptId,
    executionPlan: {
      executionPlanId: plan.executionPlanId,
      contentDigest: plan.contentDigest,
      schemaVersion: plan.schemaVersion,
    },
    effectKey: `${ids.workflowId}:execution-lifecycle-v1:dispatch`,
  }
}

function status(state, attempt = false) {
  return {
    executionId: ids.executionId,
    ...(attempt ? { attemptId: ids.attemptId } : {}),
    state,
    effectKey: `${ids.workflowId}:execution-lifecycle-v1:${state}`,
  }
}

function executionPlan() {
  return createExecutionPlanTestFixture()
}

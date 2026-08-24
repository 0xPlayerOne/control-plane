import { describe, expect, test } from 'bun:test'
import {
  ExecutionReconciliationService,
  InMemoryReconciliationCheckpointRepository,
} from './execution-reconciliation.ts'

const executionId = 'exe_01ARZ3NDEKTSV4RRFFQ69G5FAV'
const attemptId = 'att_01ARZ3NDEKTSV4RRFFQ69G5FAV'
const checkedAt = '2026-08-24T15:00:00.000Z'

function observation(overrides = {}) {
  return {
    executionId,
    checkedAt,
    command: { status: 'processing', commandId: 'cmd_01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    execution: { state: 'running', updatedAt: '2026-08-24T14:00:00.000Z' },
    attempt: {
      attemptId,
      sequence: 1,
      state: 'running',
      updatedAt: '2026-08-24T14:00:00.000Z',
      runtimeCommandId: 'runtime-command-1',
    },
    workflow: {
      workflowId: 'wfl_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      status: 'running',
      lastProgressAt: '2026-08-24T14:00:00.000Z',
    },
    runtime: { status: 'running', observedAt: checkedAt },
    delivery: { pendingCount: 0 },
    ...overrides,
  }
}

function harness(current, { thresholdMs = 60_000 } = {}) {
  const repository = new InMemoryReconciliationCheckpointRepository()
  const effects = []
  const service = new ExecutionReconciliationService({
    repository,
    source: {
      load: async () => current,
      listCandidates: async () => [executionId],
    },
    effects: {
      markReconciliationRequired: async (input) => effects.push(['mark', input]),
      resumeWorkflow: async (input) => effects.push(['resume', input]),
      applyRuntimeTerminal: async (input) => effects.push(['terminal', input]),
      replayEvents: async (input) => effects.push(['replay', input]),
    },
    policy: { staleAfterMs: thresholdMs },
  })
  return { effects, repository, service }
}

describe('execution reconciliation', () => {
  test('resumes the existing workflow for accepted-but-unstarted work without creating an execution', async () => {
    const current = observation({
      command: { status: 'accepted', commandId: 'cmd_01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      execution: { state: 'accepted', updatedAt: '2026-08-24T14:00:00.000Z' },
      attempt: undefined,
      workflow: { status: 'missing' },
      runtime: { status: 'unknown', observedAt: checkedAt },
    })
    const { effects, service } = harness(current)

    const checkpoint = await service.reconcile(executionId)

    expect(checkpoint).toMatchObject({
      reason: 'accepted_unstarted',
      state: 'remediated',
      action: 'resume_existing_workflow',
    })
    expect(effects.map(([kind]) => kind)).toEqual(['mark', 'resume'])
    expect(effects[1][1]).toMatchObject({ executionId, checkpointId: checkpoint.checkpointId })
  })

  test('marks stale running work reconciling and waits when the runtime confirms it is still running', async () => {
    const { effects, service } = harness(observation())

    const checkpoint = await service.reconcile(executionId)

    expect(checkpoint).toMatchObject({
      reason: 'stale_heartbeat',
      state: 'waiting',
      action: 'wait_for_runtime',
    })
    expect(effects.map(([kind]) => kind)).toEqual(['mark'])
  })

  test.each([
    ['disconnected', 'runtime_disconnected'],
    ['not_found', 'runtime_disappeared'],
  ])('requires manual intervention when a runtime is %s', async (runtimeStatus, reason) => {
    const { effects, service } = harness(
      observation({ runtime: { status: runtimeStatus, observedAt: checkedAt } })
    )

    const checkpoint = await service.reconcile(executionId)

    expect(checkpoint).toMatchObject({
      reason,
      state: 'manual_intervention',
      action: 'manual_intervention',
    })
    expect(effects.map(([kind]) => kind)).toEqual(['mark'])
  })

  test('recovers a runtime terminal outcome once after a lost acknowledgement', async () => {
    const current = observation({
      runtime: {
        status: 'completed',
        observedAt: checkedAt,
        resultReference: 'art_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      },
    })
    const { effects, service } = harness(current)

    const [first, replay] = await Promise.all([
      service.reconcile(executionId),
      service.reconcile(executionId),
    ])

    expect(first).toEqual(replay)
    expect(first).toMatchObject({
      reason: 'runtime_terminal_unrecorded',
      state: 'remediated',
      action: 'apply_runtime_terminal',
    })
    expect(effects.filter(([kind]) => kind === 'terminal')).toHaveLength(1)
    expect(effects.find(([kind]) => kind === 'terminal')[1]).toMatchObject({
      outcome: 'completed',
      resultReference: 'art_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    })
  })

  test('replays terminal-but-undelivered events without reapplying the terminal outcome', async () => {
    const { effects, service } = harness(
      observation({
        execution: {
          state: 'completed',
          updatedAt: '2026-08-24T14:00:00.000Z',
          terminalResultRef: 'art_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        },
        attempt: { ...observation().attempt, state: 'completed' },
        workflow: { status: 'completed', lastProgressAt: '2026-08-24T14:00:00.000Z' },
        runtime: { status: 'completed', observedAt: checkedAt },
        delivery: { pendingCount: 2, oldestPendingAt: '2026-08-24T14:01:00.000Z' },
      })
    )

    const checkpoint = await service.reconcile(executionId)

    expect(checkpoint).toMatchObject({
      reason: 'terminal_undelivered',
      state: 'remediated',
      action: 'replay_events',
    })
    expect(effects.map(([kind]) => kind)).toEqual(['replay'])
  })

  test('detects a stalled workflow independently of a healthy runtime heartbeat', async () => {
    const current = observation({
      execution: { state: 'starting', updatedAt: '2026-08-24T14:59:30.000Z' },
      attempt: {
        ...observation().attempt,
        state: 'starting',
        updatedAt: '2026-08-24T14:59:30.000Z',
      },
      workflow: {
        workflowId: 'wfl_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        status: 'running',
        lastProgressAt: '2026-08-24T14:00:00.000Z',
      },
    })
    const { service } = harness(current)

    expect(await service.reconcile(executionId)).toMatchObject({
      reason: 'workflow_stalled',
      state: 'waiting',
      action: 'wait_for_runtime',
    })
  })

  test('scheduled batches use the same idempotent reconciliation path', async () => {
    const { effects, service } = harness(observation())

    expect(await service.runBatch({ limit: 25 })).toEqual({
      examined: 1,
      reconciled: 1,
      remediated: 0,
      manualIntervention: 0,
      waiting: 1,
    })
    expect(await service.runBatch({ limit: 25 })).toEqual({
      examined: 1,
      reconciled: 0,
      remediated: 0,
      manualIntervention: 0,
      waiting: 1,
    })
    expect(effects.filter(([kind]) => kind === 'mark')).toHaveLength(1)
  })

  test('poll timestamps do not repeat remediation for the same durable facts', async () => {
    let poll = observation({
      command: { status: 'accepted', commandId: 'cmd_01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      execution: { state: 'accepted', updatedAt: '2026-08-24T14:00:00.000Z' },
      attempt: undefined,
      workflow: { status: 'missing' },
      runtime: { status: 'unknown', observedAt: checkedAt },
    })
    const repository = new InMemoryReconciliationCheckpointRepository()
    const effects = []
    const service = new ExecutionReconciliationService({
      repository,
      source: { load: async () => poll, listCandidates: async () => [] },
      effects: {
        markReconciliationRequired: async () => effects.push('mark'),
        resumeWorkflow: async () => effects.push('resume'),
        applyRuntimeTerminal: async () => effects.push('terminal'),
        replayEvents: async () => effects.push('replay'),
      },
    })

    const first = await service.reconcile(executionId)
    poll = {
      ...poll,
      checkedAt: '2026-08-24T15:05:00.000Z',
      runtime: { ...poll.runtime, observedAt: '2026-08-24T15:05:00.000Z' },
    }
    const replay = await service.reconcile(executionId)

    expect(replay).toEqual(first)
    expect(effects).toEqual(['mark', 'resume'])
  })

  test('restarts a checkpoint left reconciling after an effect failure with the same effect key', async () => {
    const current = observation({
      command: { status: 'accepted', commandId: 'cmd_01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      execution: { state: 'accepted', updatedAt: '2026-08-24T14:00:00.000Z' },
      attempt: undefined,
      workflow: { status: 'missing' },
      runtime: { status: 'unknown', observedAt: checkedAt },
    })
    const repository = new InMemoryReconciliationCheckpointRepository()
    const effectKeys = []
    let failOnce = true
    const options = {
      repository,
      source: { load: async () => current, listCandidates: async () => [] },
      effects: {
        markReconciliationRequired: async ({ checkpointId }) =>
          effectKeys.push(`mark:${checkpointId}`),
        resumeWorkflow: async ({ checkpointId }) => {
          effectKeys.push(`resume:${checkpointId}`)
          if (failOnce) {
            failOnce = false
            throw new Error('injected crash')
          }
        },
        applyRuntimeTerminal: async () => undefined,
        replayEvents: async () => undefined,
      },
    }

    await expect(
      new ExecutionReconciliationService(options).reconcile(executionId)
    ).rejects.toThrow('injected crash')
    const recovered = await new ExecutionReconciliationService(options).reconcile(executionId)

    expect(recovered.state).toBe('remediated')
    expect(new Set(effectKeys.map((key) => key.split(':').at(-1)))).toEqual(
      new Set([recovered.checkpointId])
    )
  })
})

import { describe, expect, test } from 'bun:test'
import { runExecutionLifecycle, workflowPolicies } from './execution-workflow.ts'

const input = {
  executionId: 'exe_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  workflowId: 'wfl_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  executionPlan: {
    executionPlanId: 'pln_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    contentDigest: `sha256:${'a'.repeat(64)}`,
    schemaVersion: 1,
  },
  deadlineAt: '2026-08-24T13:00:00.000Z',
}

function fakeActivities({ failDispatchOnce = false } = {}) {
  const attempts = new Map()
  const effects = new Set()
  const states = []
  const statusUpdates = []
  let dispatchCalls = 0
  const interactionEffects = []
  return {
    attempts,
    effects,
    states,
    statusUpdates,
    interactionEffects,
    activities: {
      ensureAttempt: async ({ executionId, effectKey }) => {
        if (!attempts.has(effectKey)) attempts.set(effectKey, `att_${executionId.slice(4)}`)
        return { attemptId: attempts.get(effectKey) }
      },
      persistStatus: async (update) => {
        statusUpdates.push(globalThis.structuredClone(update))
        states.push(update.state)
      },
      dispatch: async ({ effectKey }) => {
        dispatchCalls += 1
        if (failDispatchOnce && dispatchCalls === 1) throw new Error('transient')
        effects.add(effectKey)
        return { outcome: 'completed', resultReference: 'art_01ARZ3NDEKTSV4RRFFQ69G5FAV' }
      },
      applyInteraction: async (interaction) => {
        interactionEffects.push(interaction)
        return { outcome: 'completed', resultReference: 'art_01ARZ3NDEKTSV4RRFFQ69G5FAV' }
      },
      cleanup: async () => undefined,
    },
  }
}

describe('Restate execution lifecycle', () => {
  test('replay after worker restart converges on one attempt and dispatch effect', async () => {
    const fake = fakeActivities()
    const first = await runExecutionLifecycle(input, fake.activities)
    const replay = await runExecutionLifecycle(input, fake.activities)

    expect(first).toEqual(replay)
    expect(fake.attempts.size).toBe(1)
    expect(fake.effects.size).toBe(1)
    expect(fake.states).toEqual([
      'queued',
      'starting',
      'running',
      'completed',
      'queued',
      'starting',
      'running',
      'completed',
    ])
  })

  test('activity retry reuses stable effect keys instead of creating another attempt', async () => {
    const fake = fakeActivities({ failDispatchOnce: true })
    await expect(runExecutionLifecycle(input, fake.activities)).rejects.toThrow('transient')
    const result = await runExecutionLifecycle(input, fake.activities)
    expect(result.status).toBe('completed')
    expect(fake.attempts.size).toBe(1)
    expect(fake.effects.size).toBe(1)
  })

  test('maps cancellation and deadlines to normalized terminal states with cleanup', async () => {
    const cancelled = fakeActivities()
    const cancellation = await runExecutionLifecycle(input, cancelled.activities, {
      cancelled: true,
    })
    expect(cancellation.status).toBe('cancelled')
    expect(cancelled.states.at(-1)).toBe('cancelled')

    const timedOut = fakeActivities()
    const timeout = await runExecutionLifecycle(input, timedOut.activities, {
      deadlineReached: true,
    })
    expect(timeout.status).toBe('timed_out')
    expect(timedOut.states.at(-1)).toBe('timed_out')
  })

  test('persists bounded runtime failure metadata', async () => {
    const fake = fakeActivities()
    fake.activities.dispatch = async () => ({
      outcome: 'failed',
      failureCode: 'MANAGED_RUNTIME_FAILED',
      retryable: false,
    })

    await expect(runExecutionLifecycle(input, fake.activities)).resolves.toMatchObject({
      status: 'failed',
    })
    expect(fake.statusUpdates.at(-1)).toMatchObject({
      state: 'failed',
      failure: { classification: 'runtime_error', code: 'MANAGED_RUNTIME_FAILED' },
    })
  })

  test('waits durably for a normalized interaction response before resuming', async () => {
    const fake = fakeActivities()
    fake.activities.dispatch = async () => ({
      outcome: 'awaiting_input',
      interactionId: 'int_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    })

    const result = await runExecutionLifecycle(input, fake.activities, {
      waitForInteraction: async (interactionId) => ({
        interactionId,
        responseId: 'cmd_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        action: 'approve',
      }),
    })

    expect(result.status).toBe('completed')
    expect(fake.states).toEqual(['queued', 'starting', 'running', 'awaiting_input', 'completed'])
    expect(fake.interactionEffects).toEqual([
      expect.objectContaining({
        interactionId: 'int_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        responseId: 'cmd_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        action: 'approve',
      }),
    ])
  })

  test('pins workflow versioning and bounded activity policies', () => {
    expect(workflowPolicies.version).toBe('execution-lifecycle-v1')
    expect(workflowPolicies.graphSegmentVersion).toBe('execution-graph-segments-v1')
    expect(workflowPolicies.activities).toMatchObject({
      retry: { maximumAttempts: 5 },
      startToCloseTimeout: '2 minutes',
      heartbeatTimeout: '20 seconds',
    })
    expect(workflowPolicies.progressPersistence).toBe('postgres-execution-events')
  })

  test('waits at a graph checkpoint and resumes without placing graph events in workflow state', async () => {
    const fake = fakeActivities()
    const graphCalls = []
    fake.activities.runGraphSegment = async (segment) => {
      graphCalls.push(segment)
      return {
        outcome: 'awaiting_input',
        interactionId: 'int_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        checkpointId: 'checkpoint-1',
      }
    }
    fake.activities.resumeGraphSegment = async (segment) => {
      graphCalls.push(segment)
      return {
        outcome: 'completed',
        resultReference: 'art_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        checkpointId: 'checkpoint-2',
      }
    }
    const graphInput = {
      ...input,
      graph: {
        workspaceId: 'wsp_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        reference: {
          graphDefinitionId: 'manager-graph',
          graphVersion: '1.0.0',
          contentDigest: `sha256:${'b'.repeat(64)}`,
        },
        threadId: 'thread-manager-1',
        input: { objective: 'coordinate' },
      },
    }
    const result = await runExecutionLifecycle(graphInput, fake.activities, {
      waitForInteraction: async (interactionId) => ({
        interactionId,
        responseId: 'cmd_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        action: 'approve',
      }),
    })
    expect(result).toMatchObject({
      status: 'completed',
      resultReference: 'art_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    })
    expect(graphCalls).toHaveLength(2)
    expect(graphCalls[1]).toMatchObject({
      checkpointId: 'checkpoint-1',
      response: { action: 'approve' },
    })
    expect(JSON.stringify(result)).not.toContain('events')
  })
})

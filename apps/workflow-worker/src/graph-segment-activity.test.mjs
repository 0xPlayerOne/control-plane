import { describe, expect, test } from 'bun:test'
import { OrchestrationGraphSegmentActivities } from './graph-segment-activity.ts'

const base = {
  executionId: 'exe_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  attemptId: 'att_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  workspaceId: 'wsp_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  workflowId: 'wfl_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  graph: {
    graphDefinitionId: 'manager-graph',
    graphVersion: '1.0.0',
    contentDigest: `sha256:${'a'.repeat(64)}`,
  },
  threadId: 'thread-manager-1',
  idempotencyKey: 'workflow:segment:1',
}

describe('runGraphSegment activity boundary', () => {
  test('returns only coarse interrupt state and stable checkpoint correlation', async () => {
    const calls = []
    const port = {
      async run(input) {
        calls.push(input)
        return {
          status: 'awaiting_input',
          state: { privateGraphState: true },
          checkpointId: 'checkpoint-1',
          interrupt: {
            interactionKey: 'int_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            kind: 'approval',
            payload: { question: 'approve?' },
          },
          events: [{ type: 'graph.node.completed', details: { large: 'event' } }],
        }
      },
      async resume(input) {
        calls.push(input)
        return {
          status: 'completed',
          state: {},
          checkpointId: 'checkpoint-2',
          output: { artifactRef: 'art_01ARZ3NDEKTSV4RRFFQ69G5FAV' },
          events: [],
        }
      },
      async cancel(input) {
        calls.push(input)
        return true
      },
    }
    const activity = new OrchestrationGraphSegmentActivities(port)
    const interrupted = await activity.runGraphSegment({ ...base, input: { objective: 'test' } })
    expect(interrupted).toEqual({
      outcome: 'awaiting_input',
      interactionId: 'int_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      checkpointId: 'checkpoint-1',
    })
    expect(JSON.stringify(interrupted)).not.toContain('privateGraphState')
    expect(JSON.stringify(interrupted)).not.toContain('large')

    const resumed = await activity.resumeGraphSegment({
      ...base,
      checkpointId: interrupted.checkpointId,
      response: { action: 'approve' },
    })
    expect(resumed).toEqual({
      outcome: 'completed',
      resultReference: 'art_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      checkpointId: 'checkpoint-2',
    })
    expect(calls).toHaveLength(2)

    await activity.cancelGraphSegment({
      ...base,
      reason: 'user_request',
    })
    expect(calls.at(-1)).toEqual(
      expect.objectContaining({ executionId: base.executionId, reason: 'user_request' })
    )
  })

  test('normalizes failed, cancelled, and continue segment outcomes', async () => {
    for (const result of [
      {
        status: 'failed',
        state: {},
        failure: { code: 'GRAPH_FAILED', retryable: true },
        events: [],
      },
      { status: 'cancelled', state: {}, events: [] },
      { status: 'continue', state: {}, checkpointId: 'checkpoint-3', events: [] },
    ]) {
      const activity = new OrchestrationGraphSegmentActivities({
        async run() {
          return result
        },
        async resume() {
          return result
        },
        async cancel() {
          return true
        },
      })
      expect((await activity.runGraphSegment({ ...base, input: {} })).outcome).toBe(
        result.status === 'continue' ? 'continue' : result.status
      )
    }
  })
})

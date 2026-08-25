import { describe, expect, test } from 'bun:test'
import {
  GraphExecutionRequestSchema,
  GraphSegmentResultSchema,
  OrchestrationError,
  createGraphEvent,
} from './index.ts'

const ids = {
  executionId: 'exe_01JABCDEF0123456789ABCDEFG',
  attemptId: 'att_01JABCDEF0123456789ABCDEFG',
  workspaceId: 'wsp_01JABCDEF0123456789ABCDEFG',
  workflowId: 'wfl_01JABCDEF0123456789ABCDEFG',
}

describe('orchestration port contracts', () => {
  test('normalizes graph identity, state, and durable correlation without vendor types', () => {
    const request = GraphExecutionRequestSchema.parse({
      ...ids,
      graph: {
        graphDefinitionId: 'manager-graph',
        graphVersion: '1.0.0',
        contentDigest: `sha256:${'a'.repeat(64)}`,
      },
      threadId: 'thread-manager-1',
      input: { objective: 'coordinate work' },
      idempotencyKey: 'workflow-1:segment-1',
    })
    expect(request.graph.graphVersion).toBe('1.0.0')
    expect(JSON.stringify(request)).not.toContain('langgraph')
  })

  test('requires checkpoint identity for continuations and interrupts', () => {
    expect(() =>
      GraphSegmentResultSchema.parse({ status: 'continue', state: {}, events: [] })
    ).toThrow()
    expect(
      GraphSegmentResultSchema.parse({
        status: 'awaiting_input',
        state: { phase: 'approval' },
        checkpointId: 'checkpoint-1',
        interrupt: { interactionKey: 'approval-1', kind: 'approval', payload: { risk: 'low' } },
        events: [],
      }).status
    ).toBe('awaiting_input')
  })

  test('creates sequenced, correlated lifecycle events and safe errors', () => {
    const event = createGraphEvent({
      ...ids,
      threadId: 'thread-manager-1',
      sequence: 2,
      type: 'graph.node.completed',
      node: 'research',
      occurredAt: '2026-08-25T12:00:00.000Z',
      details: { output: 'artifact reference only' },
    })
    expect(event).toMatchObject({ sequence: 2, node: 'research' })
    expect(new OrchestrationError('GRAPH_FAILED', false, new Error('secret')).message).toBe(
      'GRAPH_FAILED'
    )
  })
})

import { describe, expect, test } from 'bun:test'
import { MemorySaver } from '@langchain/langgraph'
import { LangGraphOrchestrationAdapter, deterministicTestGraph } from './index.ts'

const request = {
  executionId: 'exe_01JABCDEF0123456789ABCDEFG',
  attemptId: 'att_01JABCDEF0123456789ABCDEFG',
  workspaceId: 'wsp_01JABCDEF0123456789ABCDEFG',
  workflowId: 'wfl_01JABCDEF0123456789ABCDEFG',
  graph: {
    graphDefinitionId: 'deterministic-test',
    graphVersion: '1.0.0',
    contentDigest: `sha256:${'a'.repeat(64)}`,
  },
  threadId: 'thread-test-1',
  input: { objective: 'verify boundaries' },
  idempotencyKey: 'test:segment:1',
}

describe('LangGraph orchestration adapter', () => {
  test('executes multiple nodes through the normalized operation port', async () => {
    const calls = []
    const events = []
    const adapter = new LangGraphOrchestrationAdapter({
      graphs: [deterministicTestGraph(request.graph)],
      checkpointer: new MemorySaver(),
      operations: {
        async invoke(operation) {
          calls.push(operation)
          return { value: `${operation.kind}:${operation.name}` }
        },
        async cancel() {
          return true
        },
      },
      events: {
        async publish(event) {
          events.push(event)
        },
      },
      now: () => '2026-08-25T12:00:00.000Z',
    })
    const result = await adapter.run(request)
    expect(result).toMatchObject({ status: 'completed', output: { summary: 'tool:lookup' } })
    expect(calls.map(({ kind }) => kind)).toEqual(['runtime', 'model', 'tool'])
    expect(events.map(({ type }) => type)).toContain('graph.node.completed')
  })

  test('normalizes graph failures and cancellation without exposing input', async () => {
    const adapter = new LangGraphOrchestrationAdapter({
      graphs: [deterministicTestGraph(request.graph)],
      checkpointer: new MemorySaver(),
      operations: {
        async invoke() {
          throw new Error('provider secret verify boundaries')
        },
        async cancel() {
          return true
        },
      },
      events: { async publish() {} },
    })
    await expect(adapter.run(request)).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'GRAPH_FAILED', retryable: true },
    })
    await expect(
      adapter.cancel({
        executionId: request.executionId,
        attemptId: request.attemptId,
        workspaceId: request.workspaceId,
        workflowId: request.workflowId,
        graph: request.graph,
        threadId: request.threadId,
        reason: 'user_request',
      })
    ).resolves.toBe(true)
  })
})

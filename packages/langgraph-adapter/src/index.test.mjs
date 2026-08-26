import { describe, expect, test } from 'bun:test'
import { MemorySaver } from '@langchain/langgraph'
import {
  LangGraphOrchestrationAdapter,
  deterministicInterruptGraph,
  deterministicTestGraph,
} from './index.ts'
import { createTelemetry } from '@control-plane/telemetry'

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

  test('emits correlated spans from real graph and node execution paths', async () => {
    const spans = []
    const telemetry = createTelemetry({
      serviceName: 'workflow-worker',
      traceAdapter: {
        startSpan(input) {
          const record = { input, outcome: undefined }
          spans.push(record)
          return { end: (outcome) => (record.outcome = outcome) }
        },
      },
    })
    const adapter = new LangGraphOrchestrationAdapter({
      graphs: [deterministicTestGraph(request.graph)],
      checkpointer: new MemorySaver(),
      operations: {
        async invoke(operation) {
          return { value: `${operation.kind}:${operation.name}` }
        },
        async cancel() {
          return true
        },
      },
      events: { async publish() {} },
      telemetry,
    })

    await expect(
      adapter.run({ ...request, input: { authorization: 'Bearer private-graph-secret' } })
    ).resolves.toMatchObject({ status: 'completed' })

    expect(spans.map(({ input }) => input.name)).toEqual([
      'graph.run',
      'graph.node',
      'runtime.start',
      'graph.node',
      'model.call',
      'graph.node',
      'tool.execute',
    ])
    expect(
      spans.every(
        ({ input }) =>
          input.attributes['execution.id'] === request.executionId &&
          input.attributes['workflow.id'] === request.workflowId
      )
    ).toBe(true)
    expect(spans.every(({ outcome }) => outcome.status === 'ok')).toBe(true)
    expect(JSON.stringify(spans)).not.toContain('private-graph-secret')
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

  test('resumes an interrupt from its exact durable checkpoint after adapter restart', async () => {
    const checkpointer = new MemorySaver()
    const calls = []
    const options = {
      graphs: [deterministicInterruptGraph(request.graph)],
      checkpointer,
      operations: {
        async invoke(operation) {
          calls.push(operation)
          return { value: operation.name }
        },
        async cancel() {
          return true
        },
      },
      events: { async publish() {} },
      now: () => '2026-08-25T12:00:00.000Z',
    }
    const first = await new LangGraphOrchestrationAdapter(options).run(request)
    expect(first).toMatchObject({
      status: 'awaiting_input',
      interrupt: { interactionKey: 'approval-1', kind: 'approval' },
    })
    expect(first.checkpointId).toBeString()

    const resumed = await new LangGraphOrchestrationAdapter(options).resume({
      executionId: request.executionId,
      attemptId: request.attemptId,
      workspaceId: request.workspaceId,
      workflowId: request.workflowId,
      graph: request.graph,
      threadId: request.threadId,
      checkpointId: first.checkpointId,
      response: { action: 'approve' },
      idempotencyKey: 'test:segment:resume:approval-1',
    })
    expect(resumed).toMatchObject({ status: 'completed', output: { decision: 'approve' } })
    expect(calls.map(({ name }) => name)).toEqual(['prepare', 'finalize'])
  })

  test('keeps node side-effect idempotency keys stable across activity retry', async () => {
    const effects = new Set()
    const adapter = new LangGraphOrchestrationAdapter({
      graphs: [deterministicTestGraph(request.graph)],
      checkpointer: new MemorySaver(),
      operations: {
        async invoke(operation) {
          effects.add(operation.idempotencyKey)
          return { value: operation.name }
        },
        async cancel() {
          return true
        },
      },
      events: { async publish() {} },
    })
    await adapter.run(request)
    await adapter.run(request)
    expect(effects).toEqual(
      new Set(['test:segment:1:prepare', 'test:segment:1:reason', 'test:segment:1:lookup'])
    )
  })
})

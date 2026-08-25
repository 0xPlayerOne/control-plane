import { Annotation, END, START, StateGraph, type BaseCheckpointSaver } from '@langchain/langgraph'
import {
  GraphCancellationRequestSchema,
  GraphExecutionRequestSchema,
  GraphResumeRequestSchema,
  GraphSegmentResultSchema,
  OrchestrationError,
  createGraphEvent,
  type GraphEvent,
  type GraphEventPublisher,
  type GraphNodeOperationPort,
  type GraphReference,
  type GraphSegmentResult,
  type OrchestrationPort,
} from '@control-plane/orchestration'
import { z } from 'zod'

const JsonRecordSchema = z.record(z.string(), z.json())
type JsonRecord = z.output<typeof JsonRecordSchema>

const ManagedState = Annotation.Root({
  input: Annotation<JsonRecord>,
  values: Annotation<JsonRecord>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({}),
  }),
  output: Annotation<JsonRecord>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({}),
  }),
})

interface GraphRunnable {
  invoke(input: unknown, config: Record<string, unknown>): Promise<JsonRecord>
  getState(config: Record<string, unknown>): Promise<{
    readonly config?: { readonly configurable?: Record<string, unknown> }
  }>
}

interface GraphBuildContext {
  readonly operations: GraphNodeOperationPort
  readonly checkpointer: BaseCheckpointSaver
  readonly invokeOperation: (
    node: string,
    kind: 'runtime' | 'model' | 'tool' | 'delegation',
    name: string,
    state: JsonRecord
  ) => Promise<Readonly<Record<string, unknown>>>
}

export interface LangGraphRegistration {
  readonly reference: GraphReference
  build(context: GraphBuildContext): GraphRunnable
}

export class LangGraphOrchestrationAdapter implements OrchestrationPort {
  readonly #graphs = new Map<string, LangGraphRegistration>()
  readonly #operations: GraphNodeOperationPort
  readonly #events: GraphEventPublisher
  readonly #checkpointer: BaseCheckpointSaver
  readonly #now: () => string
  readonly #compilerVersion: string
  readonly #adapterVersion: string
  readonly #active = new Map<string, AbortController>()

  constructor(options: {
    readonly graphs: readonly LangGraphRegistration[]
    readonly operations: GraphNodeOperationPort
    readonly events: GraphEventPublisher
    readonly checkpointer: BaseCheckpointSaver
    readonly now?: () => string
    readonly compilerVersion?: string
    readonly adapterVersion?: string
  }) {
    this.#operations = options.operations
    this.#events = options.events
    this.#checkpointer = options.checkpointer
    this.#now = options.now ?? (() => new Date().toISOString())
    this.#compilerVersion = options.compilerVersion ?? '1.0.0'
    this.#adapterVersion = options.adapterVersion ?? '1.4.12'
    for (const graph of options.graphs) {
      const key = graphKey(graph.reference)
      if (this.#graphs.has(key)) throw new OrchestrationError('GRAPH_VERSION_MISMATCH', false)
      this.#graphs.set(key, graph)
    }
  }

  async run(input: unknown): Promise<GraphSegmentResult> {
    const parsed = GraphExecutionRequestSchema.safeParse(input)
    if (!parsed.success) throw new OrchestrationError('INVALID_GRAPH_REQUEST', false)
    return this.#invoke(parsed.data, parsed.data.input, 'graph.started')
  }

  async resume(input: unknown): Promise<GraphSegmentResult> {
    const parsed = GraphResumeRequestSchema.safeParse(input)
    if (!parsed.success) throw new OrchestrationError('INVALID_GRAPH_REQUEST', false)
    throw new OrchestrationError('RESUME_FAILED', false)
  }

  async cancel(input: unknown): Promise<boolean> {
    const parsed = GraphCancellationRequestSchema.safeParse(input)
    if (!parsed.success) throw new OrchestrationError('INVALID_GRAPH_REQUEST', false)
    this.#active.get(activeKey(parsed.data.executionId, parsed.data.threadId))?.abort()
    const cancelled = await this.#operations.cancel(parsed.data.executionId, parsed.data.threadId)
    await this.#events.publish(
      createGraphEvent({
        ...correlation(parsed.data),
        threadId: parsed.data.threadId,
        sequence: 1,
        type: 'graph.cancelled',
        occurredAt: this.#now(),
        details: { reason: parsed.data.reason },
      })
    )
    return cancelled
  }

  async #invoke(
    request: ReturnType<typeof GraphExecutionRequestSchema.parse>,
    graphInput: JsonRecord,
    initialEvent: GraphEvent['type']
  ): Promise<GraphSegmentResult> {
    const registration = this.#graphs.get(graphKey(request.graph))
    if (!registration) throw new OrchestrationError('GRAPH_NOT_FOUND', false)
    const controller = new AbortController()
    const key = activeKey(request.executionId, request.threadId)
    if (this.#active.has(key)) throw new OrchestrationError('GRAPH_FAILED', true)
    this.#active.set(key, controller)
    const emitted: GraphEvent[] = []
    let sequence = 0
    const emit = async (type: GraphEvent['type'], node?: string, details: JsonRecord = {}) => {
      const event = createGraphEvent({
        ...correlation(request),
        threadId: request.threadId,
        sequence: ++sequence,
        type,
        ...(node ? { node } : {}),
        occurredAt: this.#now(),
        details,
      })
      emitted.push(event)
      await this.#events.publish(event)
    }
    try {
      await emit(initialEvent)
      const graph = registration.build({
        operations: this.#operations,
        checkpointer: this.#checkpointer,
        invokeOperation: async (node, kind, name, state) => {
          if (controller.signal.aborted) throw new OrchestrationError('GRAPH_CANCELLED', false)
          await emit('graph.node.started', node, { kind, operation: name })
          const result = JsonRecordSchema.parse(
            await this.#operations.invoke({
              executionId: request.executionId,
              attemptId: request.attemptId,
              workspaceId: request.workspaceId,
              workflowId: request.workflowId,
              threadId: request.threadId,
              node,
              kind,
              name,
              input: state,
              idempotencyKey: `${request.idempotencyKey}:${node}`,
            })
          )
          await emit('graph.node.completed', node, { kind, operation: name })
          return result
        },
      })
      const config = {
        configurable: {
          thread_id: request.threadId,
          checkpoint_ns: `${request.workspaceId}:${request.executionId}`,
        },
        metadata: {
          graphDefinitionId: request.graph.graphDefinitionId,
          graphVersion: request.graph.graphVersion,
          contentDigest: request.graph.contentDigest,
          executionId: request.executionId,
          workflowId: request.workflowId,
          workspaceId: request.workspaceId,
          compilerVersion: this.#compilerVersion,
          adapterVersion: this.#adapterVersion,
        },
        signal: controller.signal,
      }
      const state = await graph.invoke({ input: graphInput, values: {}, output: {} }, config)
      const snapshot = await graph.getState(config)
      const checkpointId = snapshot.config?.configurable?.['checkpoint_id']
      await emit('graph.completed')
      return GraphSegmentResultSchema.parse({
        status: 'completed',
        state,
        ...(typeof checkpointId === 'string' ? { checkpointId } : {}),
        output: state['output'] ?? {},
        events: emitted,
      })
    } catch (error) {
      if (error instanceof OrchestrationError && error.code === 'GRAPH_CANCELLED') {
        return GraphSegmentResultSchema.parse({ status: 'cancelled', state: {}, events: emitted })
      }
      try {
        await emit('graph.failed', undefined, { code: 'GRAPH_FAILED' })
      } catch {
        // The original sanitized orchestration failure remains authoritative.
      }
      return GraphSegmentResultSchema.parse({
        status: 'failed',
        state: {},
        failure: { code: 'GRAPH_FAILED', retryable: true },
        events: emitted,
      })
    } finally {
      this.#active.delete(key)
    }
  }
}

export function deterministicTestGraph(reference: GraphReference): LangGraphRegistration {
  return {
    reference,
    build(context) {
      const graph = new StateGraph(ManagedState)
        .addNode('prepare', async (state) => {
          const result = await context.invokeOperation('prepare', 'runtime', 'prepare', state.input)
          return { values: { prepared: result['value'] } }
        })
        .addNode('reason', async (state) => {
          const result = await context.invokeOperation('reason', 'model', 'reason', state.values)
          return { values: { reasoned: result['value'] } }
        })
        .addNode('lookup', async (state) => {
          const result = await context.invokeOperation('lookup', 'tool', 'lookup', state.values)
          return { output: { summary: result['value'] } }
        })
        .addEdge(START, 'prepare')
        .addEdge('prepare', 'reason')
        .addEdge('reason', 'lookup')
        .addEdge('lookup', END)
        .compile({ checkpointer: context.checkpointer })
      return graph
    },
  }
}

function correlation(input: {
  readonly executionId: string
  readonly attemptId: string
  readonly workspaceId: string
  readonly workflowId: string
}) {
  return {
    executionId: input.executionId,
    attemptId: input.attemptId,
    workspaceId: input.workspaceId,
    workflowId: input.workflowId,
  }
}

function graphKey(reference: GraphReference): string {
  return `${reference.graphDefinitionId}:${reference.graphVersion}:${reference.contentDigest}`
}

function activeKey(executionId: string, threadId: string): string {
  return `${executionId}:${threadId}`
}

export const packageName = 'langgraph-adapter'

export * from './postgres-checkpointer.js'

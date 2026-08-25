import { createHash } from 'node:crypto'
import {
  RuntimeAdapterInspectionSchema,
  RuntimeApprovalRequestSchema,
  RuntimeCancelRequestSchema,
  RuntimeExecutionHandleSchema,
  RuntimeExecutionResultSchema,
  RuntimeExecutionStatusSchema,
  RuntimeInputRequestSchema,
  RuntimeSessionOperationSchema,
  RuntimeSessionResultSchema,
  RuntimeStartRequestSchema,
  RuntimeAdapterError,
  inspectRuntimeCapabilities,
  type RuntimeAdapter,
  type RuntimeAdapterInspection,
  type RuntimeExecutionHandle,
  type RuntimeExecutionProgress,
  type RuntimeExecutionResult,
  type RuntimeExecutionStatus,
  type RuntimeProgressOptions,
  type RuntimeSessionOperation,
  type RuntimeSessionResult,
} from './adapter.js'
import { RuntimeCapabilitySchema, type RuntimeCapability } from './capabilities.js'

interface MockExecution {
  readonly handle: RuntimeExecutionHandle
  status: RuntimeExecutionStatus
  readonly progress: RuntimeExecutionProgress[]
  nextSequence: number
}

interface MockSession {
  sessionId: string
  state: 'active' | 'closed'
  observedAt: string
}

export interface MockRuntimeAdapterOptions {
  readonly now?: () => string
  readonly capabilities?: readonly RuntimeCapability[]
  readonly health?: RuntimeAdapterInspection['health']
  readonly limitations?: readonly string[]
}

export class MockRuntimeAdapter implements RuntimeAdapter {
  readonly #now: () => string
  readonly #capabilities: RuntimeCapability[]
  readonly #health: RuntimeAdapterInspection['health']
  readonly #limitations: string[]
  readonly #executions = new Map<string, MockExecution>()
  readonly #starts = new Map<string, { fingerprint: string; handle: RuntimeExecutionHandle }>()
  readonly #actions = new Map<string, { fingerprint: string; status: RuntimeExecutionStatus }>()
  readonly #sessions = new Map<string, MockSession>()
  readonly #sessionCreates = new Map<string, RuntimeSessionResult>()

  constructor(options: MockRuntimeAdapterOptions = {}) {
    this.#now = options.now ?? (() => new Date().toISOString())
    this.#capabilities = (
      options.capabilities ?? [
        { name: 'stream.output', support: 'supported' },
        { name: 'execution.cancel', support: 'supported' },
      ]
    ).map((capability) => RuntimeCapabilitySchema.parse(capability))
    this.#health = options.health ?? 'healthy'
    this.#limitations = [...(options.limitations ?? [])]
  }

  async inspect(
    requirements?: Parameters<RuntimeAdapter['inspect']>[0]
  ): Promise<RuntimeAdapterInspection> {
    return RuntimeAdapterInspectionSchema.parse({
      metadata: {
        contractVersion: { major: 1, minor: 0 },
        adapterName: 'mock',
        adapterVersion: '1.0.0',
        runtimeFamily: 'mock',
        driverVersion: '1.0.0',
        harnessVersion: '1.0.0',
      },
      health: this.#health,
      capabilities: this.#capabilities,
      limitations: this.#limitations,
      observedAt: this.#now(),
      ...(requirements
        ? { capabilityEvaluation: inspectRuntimeCapabilities(this.#capabilities, requirements) }
        : {}),
    })
  }

  async start(
    requestInput: Parameters<RuntimeAdapter['start']>[0]
  ): Promise<RuntimeExecutionHandle> {
    const request = RuntimeStartRequestSchema.parse(requestInput)
    const fingerprint = stable(request)
    const replay = this.#starts.get(request.idempotencyKey)
    if (replay) {
      if (replay.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT', 'conflict', false)
      return clone(replay.handle)
    }
    const startedAt = this.#now()
    const handle = RuntimeExecutionHandleSchema.parse({
      handleId: `mock:${request.attemptId}`,
      attemptId: request.attemptId,
      startedAt,
    })
    if (this.#executions.has(handle.handleId)) fail('ATTEMPT_ALREADY_STARTED', 'conflict', false)
    const execution: MockExecution = {
      handle,
      status: RuntimeExecutionStatusSchema.parse({
        handle,
        state: 'starting',
        observedAt: startedAt,
      }),
      progress: [],
      nextSequence: 1,
    }
    this.#executions.set(handle.handleId, execution)
    this.#starts.set(request.idempotencyKey, { fingerprint, handle: clone(handle) })
    this.#emit(execution, 'status', { state: 'starting' })
    execution.status = RuntimeExecutionStatusSchema.parse({
      handle,
      state: 'running',
      observedAt: this.#now(),
    })
    this.#emit(execution, 'status', { state: 'running' })
    return clone(handle)
  }

  async *progress(
    handleInput: RuntimeExecutionHandle,
    options: RuntimeProgressOptions = {}
  ): AsyncIterable<RuntimeExecutionProgress> {
    const execution = this.#execution(handleInput)
    for (const event of execution.progress) {
      if (options.signal?.aborted) return
      if (event.sequence > (options.afterSequence ?? 0)) yield clone(event)
    }
  }

  async submitInput(
    handle: RuntimeExecutionHandle,
    requestInput: Parameters<RuntimeAdapter['submitInput']>[1]
  ): Promise<RuntimeExecutionStatus> {
    this.#requireCapability('interaction.user-input')
    const request = RuntimeInputRequestSchema.parse(requestInput)
    return this.#interaction(handle, 'input', request.idempotencyKey, request, {
      interactionId: request.interactionId,
      kind: 'input',
      accepted: true,
    })
  }

  async submitApproval(
    handle: RuntimeExecutionHandle,
    requestInput: Parameters<RuntimeAdapter['submitApproval']>[1]
  ): Promise<RuntimeExecutionStatus> {
    this.#requireCapability('interaction.approval')
    const request = RuntimeApprovalRequestSchema.parse(requestInput)
    return this.#interaction(handle, 'approval', request.idempotencyKey, request, {
      interactionId: request.interactionId,
      kind: 'approval',
      decision: request.decision,
    })
  }

  async cancel(
    handleInput: RuntimeExecutionHandle,
    requestInput: Parameters<RuntimeAdapter['cancel']>[1]
  ): Promise<RuntimeExecutionStatus> {
    this.#requireCapability('execution.cancel')
    const handle = RuntimeExecutionHandleSchema.parse(handleInput)
    const request = RuntimeCancelRequestSchema.parse(requestInput)
    const actionKey = `${handle.handleId}:cancel:${request.idempotencyKey}`
    const requestFingerprint = stable(request)
    const replay = this.#actions.get(actionKey)
    if (replay) {
      if (replay.fingerprint !== requestFingerprint) fail('IDEMPOTENCY_CONFLICT', 'conflict', false)
      return clone(replay.status)
    }
    const execution = this.#execution(handle)
    if (terminal(execution.status.state)) fail('EXECUTION_TERMINAL', 'conflict', false)
    execution.status = RuntimeExecutionStatusSchema.parse({
      handle: execution.handle,
      state: 'cancelled',
      observedAt: request.requestedAt,
    })
    this.#emit(execution, 'status', { state: 'cancelled' })
    this.#actions.set(actionKey, {
      fingerprint: requestFingerprint,
      status: clone(execution.status),
    })
    return clone(execution.status)
  }

  async status(handle: RuntimeExecutionHandle): Promise<RuntimeExecutionStatus> {
    return clone(this.#execution(handle).status)
  }

  async reconcile(handle: RuntimeExecutionHandle): Promise<RuntimeExecutionStatus> {
    return clone(this.#execution(handle).status)
  }

  async session(operationInput: RuntimeSessionOperation): Promise<RuntimeSessionResult> {
    const operation = RuntimeSessionOperationSchema.parse(operationInput)
    this.#requireCapability(`session.${operation.operation}` as RuntimeCapability['name'])
    if (operation.operation === 'create') {
      const replay = this.#sessionCreates.get(operation.idempotencyKey)
      if (replay) return clone(replay)
      const session = {
        sessionId: 'ses_01JABCDEF0123456789ABCDEFG',
        state: 'active' as const,
        observedAt: this.#now(),
      }
      this.#sessions.set(session.sessionId, session)
      const result = RuntimeSessionResultSchema.parse({ operation: 'create', session })
      this.#sessionCreates.set(operation.idempotencyKey, result)
      return clone(result)
    }
    if (operation.operation === 'list') {
      return RuntimeSessionResultSchema.parse({
        operation: 'list',
        sessions: [...this.#sessions.values()],
      })
    }
    const session = this.#sessions.get(operation.sessionId)
    if (!session) fail('SESSION_NOT_FOUND', 'validation', false)
    if (operation.operation === 'history') {
      return RuntimeSessionResultSchema.parse({
        operation: 'history',
        session,
        completeness: 'complete',
        limitations: [],
        entries: [],
      })
    }
    if (operation.operation === 'close') session.state = 'closed'
    else if (session.state === 'closed') fail('SESSION_CLOSED', 'conflict', false)
    return RuntimeSessionResultSchema.parse({ operation: operation.operation, session })
  }

  async cleanup(handleInput: RuntimeExecutionHandle): Promise<void> {
    const handle = RuntimeExecutionHandleSchema.parse(handleInput)
    this.#executions.delete(handle.handleId)
  }

  complete(
    handleInput: RuntimeExecutionHandle,
    resultInput: Omit<RuntimeExecutionResult, 'outcome'>
  ): RuntimeExecutionStatus {
    const execution = this.#execution(handleInput)
    if (terminal(execution.status.state)) return clone(execution.status)
    const result = RuntimeExecutionResultSchema.parse({ outcome: 'completed', ...resultInput })
    execution.status = RuntimeExecutionStatusSchema.parse({
      handle: execution.handle,
      state: 'completed',
      observedAt: this.#now(),
      result,
    })
    this.#emit(execution, 'status', { state: 'completed' })
    return clone(execution.status)
  }

  #interaction(
    handleInput: RuntimeExecutionHandle,
    operation: 'input' | 'approval',
    idempotencyKey: string,
    request: unknown,
    data: Record<string, string | boolean>
  ): RuntimeExecutionStatus {
    const handle = RuntimeExecutionHandleSchema.parse(handleInput)
    const actionKey = `${handle.handleId}:${operation}:${idempotencyKey}`
    const requestFingerprint = stable(request)
    const replay = this.#actions.get(actionKey)
    if (replay) {
      if (replay.fingerprint !== requestFingerprint) fail('IDEMPOTENCY_CONFLICT', 'conflict', false)
      return clone(replay.status)
    }
    const execution = this.#execution(handle)
    if (terminal(execution.status.state)) fail('EXECUTION_TERMINAL', 'conflict', false)
    this.#emit(execution, 'interaction', data)
    this.#actions.set(actionKey, {
      fingerprint: requestFingerprint,
      status: clone(execution.status),
    })
    return clone(execution.status)
  }

  #execution(handleInput: RuntimeExecutionHandle): MockExecution {
    const handle = RuntimeExecutionHandleSchema.parse(handleInput)
    const execution = this.#executions.get(handle.handleId)
    if (!execution || stable(execution.handle) !== stable(handle)) {
      fail('EXECUTION_HANDLE_NOT_FOUND', 'validation', false)
    }
    return execution
  }

  #requireCapability(name: RuntimeCapability['name']): void {
    const capability = this.#capabilities.find((candidate) => candidate.name === name)
    if (!capability || capability.support === 'unsupported') {
      fail('CAPABILITY_UNSUPPORTED', 'unsupported', false, { capability: name })
    }
  }

  #emit(
    execution: MockExecution,
    type: RuntimeExecutionProgress['type'],
    data: Record<string, string | boolean>
  ): void {
    execution.progress.push({
      handleId: execution.handle.handleId,
      sequence: execution.nextSequence++,
      occurredAt: this.#now(),
      type,
      data,
    })
  }
}

function terminal(state: RuntimeExecutionStatus['state']): boolean {
  return ['completed', 'failed', 'cancelled', 'timed_out'].includes(state)
}

function fail(
  code: string,
  classification: ConstructorParameters<typeof RuntimeAdapterError>[0]['classification'],
  retryable: boolean,
  details?: Record<string, string>
): never {
  throw new RuntimeAdapterError({
    code,
    classification,
    message: code,
    retryable,
    ...(details ? { details } : {}),
  })
}

function stable(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function clone<Value>(value: Value): Value {
  return structuredClone(value)
}

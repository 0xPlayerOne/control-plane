import {
  RuntimeAdapterError,
  RuntimeAdapterInspectionSchema,
  RuntimeApprovalRequestSchema,
  RuntimeArtifactReferenceSchema,
  RuntimeCapabilitySchema,
  RuntimeCancelRequestSchema,
  RuntimeExecutionHandleSchema,
  RuntimeExecutionProgressSchema,
  RuntimeExecutionStatusSchema,
  RuntimeInputRequestSchema,
  RuntimeConnectionSchema,
  RuntimeSessionOperationSchema,
  RuntimeSessionResultSchema,
  RuntimeStartRequestSchema,
  inspectRuntimeCapabilities,
  assessExternalSession,
  type ExternalSession,
  type ExternalSessionRegistry,
  type RuntimeAdapter,
  type RuntimeAdapterInspection,
  type RuntimeApprovalRequest,
  type RuntimeCapability,
  type RuntimeCancelRequest,
  type RuntimeExecutionHandle,
  type RuntimeExecutionPlanSnapshot,
  type RuntimeExecutionProgress,
  type RuntimeExecutionStatus,
  type RuntimeInputRequest,
  type RuntimeConnection,
  type RuntimeProgressOptions,
  type RuntimeSessionOperation,
  type RuntimeSessionResult,
} from '@control-plane/runtime-sdk'
import { z } from 'zod'

const SemanticVersionSchema = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
const TimestampSchema = z.iso.datetime()
const NativeSessionIdSchema = z.string().min(1).max(512)
const AcpInfoSchema = z
  .object({
    name: z.string().min(1).max(128),
    title: z.string().min(1).max(256).optional(),
    version: SemanticVersionSchema,
  })
  .strict()
const AcpSessionCapabilitiesSchema = z
  .object({
    prompt: z
      .object({
        image: z.object({}).strict().optional(),
        audio: z.object({}).strict().optional(),
        embeddedContext: z.object({}).strict().optional(),
      })
      .passthrough()
      .optional(),
    mcp: z
      .object({
        stdio: z.object({}).strict().optional(),
        http: z.object({}).strict().optional(),
      })
      .passthrough()
      .optional(),
    delete: z.object({}).strict().optional(),
    additionalDirectories: z.object({}).strict().optional(),
  })
  .passthrough()
const AcpControlPlaneMetadataSchema = z
  .object({
    capabilities: z.array(RuntimeCapabilitySchema.shape.name).max(64),
    driverVersion: SemanticVersionSchema,
  })
  .strict()
const AcpInitializeResultSchema = z
  .object({
    protocolVersion: z.number().int().positive(),
    capabilities: z
      .object({
        session: AcpSessionCapabilitiesSchema.optional(),
        auth: z.record(z.string(), z.json()).optional(),
        _meta: z
          .object({ controlPlane: AcpControlPlaneMetadataSchema.optional() })
          .passthrough()
          .optional(),
      })
      .passthrough(),
    info: AcpInfoSchema,
    authMethods: z.array(z.record(z.string(), z.json())).max(32).optional(),
  })
  .passthrough()
const AcpErrorSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    classification: z.enum([
      'validation',
      'unsupported',
      'unavailable',
      'conflict',
      'timeout',
      'cancelled',
      'runtime',
      'infrastructure',
      'unknown',
    ]),
    message: z.string().min(1).max(4096),
    retryable: z.boolean(),
  })
  .strict()

export const AcpUpdateSchema = z.union([
  z.object({ sessionUpdate: z.literal('state_update'), state: z.literal('running') }).strict(),
  z
    .object({
      sessionUpdate: z.literal('state_update'),
      state: z.literal('idle'),
      stopReason: z.enum(['end_turn', 'cancelled', 'refusal', 'max_tokens', 'unknown']),
    })
    .strict(),
  z
    .object({
      sessionUpdate: z.enum(['agent_message', 'agent_message_chunk']),
      messageId: z.string().min(1).max(512),
      text: z.string().max(1_000_000),
    })
    .strict(),
  z
    .object({
      sessionUpdate: z.literal('request_permission'),
      requestId: z.number().int().nonnegative(),
      toolCallId: z.string().min(1).max(512),
      title: z.string().min(1).max(1024),
      options: z
        .array(
          z
            .object({
              optionId: z.string().min(1).max(128),
              kind: z.enum(['allow_once', 'reject']),
            })
            .strict()
        )
        .min(1)
        .max(32),
    })
    .strict(),
  z
    .object({
      sessionUpdate: z.literal('elicitation'),
      requestId: z.number().int().nonnegative(),
      prompt: z.string().min(1).max(4096),
    })
    .strict(),
  z
    .object({
      sessionUpdate: z.literal('usage_update'),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      durationMs: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      sessionUpdate: z.literal('artifact'),
      artifact: RuntimeArtifactReferenceSchema,
    })
    .strict(),
])

export const AcpSnapshotSchema = z.discriminatedUnion('state', [
  z.object({ state: z.enum(['starting', 'running']), observedAt: TimestampSchema }).strict(),
  z
    .object({
      state: z.literal('completed'),
      observedAt: TimestampSchema,
      output: z.json().optional(),
      usage: z
        .object({
          inputTokens: z.number().int().nonnegative(),
          outputTokens: z.number().int().nonnegative(),
          durationMs: z.number().int().nonnegative(),
        })
        .strict(),
      artifacts: z.array(RuntimeArtifactReferenceSchema).max(1024),
    })
    .strict(),
  z.object({ state: z.literal('cancelled'), observedAt: TimestampSchema }).strict(),
  z
    .object({
      state: z.enum(['failed', 'timed_out']),
      observedAt: TimestampSchema,
      error: AcpErrorSchema,
    })
    .strict(),
])

export type AcpUpdate = z.output<typeof AcpUpdateSchema>
export type AcpSnapshot = z.output<typeof AcpSnapshotSchema>

export interface AcpTransportCall {
  readonly method: string
  readonly params: Record<string, z.util.JSONType>
}

export interface AcpTransport {
  connectionState(): 'connected' | 'disconnected'
  request(method: string, params: Record<string, z.util.JSONType>): Promise<unknown>
  respond(requestId: number, result: Record<string, z.util.JSONType>): Promise<void>
  updates(nativeSessionId: string, signal?: AbortSignal): AsyncIterable<AcpUpdate>
  snapshot(nativeSessionId: string): Promise<AcpSnapshot>
  cleanup(nativeSessionId: string): Promise<void>
  replay?(
    nativeSessionId: string,
    options?: { readonly afterSequence?: number }
  ): Promise<AcpSessionReplay>
  replaySupport?(): boolean
}

export interface AcpSessionReplay {
  readonly updates: readonly AcpUpdate[]
  readonly completeness: 'complete' | 'partial' | 'unavailable'
}

export interface AcpExternalSessionsOptions {
  readonly registry: ExternalSessionRegistry
  readonly runtimeConnection: () => RuntimeConnection
  readonly nodeStatus: () => 'online' | 'offline' | 'unknown' | 'revoked' | 'not_applicable'
  readonly workspaceId: string
  readonly projectId?: string
  readonly opaqueNativeSessionId: (nativeSessionId: string) => string
  readonly resolveNativeSessionId: (opaqueNativeSessionId: string) => Promise<string | undefined>
  readonly capabilityTtlMs: number
  readonly authorize: (
    operation: RuntimeSessionOperation['operation'],
    session?: ExternalSession
  ) => Promise<boolean>
}

export interface AcpAdapterOptions {
  readonly transport: AcpTransport
  readonly adapterVersion: string
  readonly externalSessionId: (nativeSessionId: string) => string
  readonly interactionId: (nativeRequestId: number) => string
  readonly now?: () => Date
  readonly protocolVersion?: number
  readonly externalSessions?: AcpExternalSessionsOptions
}

interface AcpExecution {
  readonly handle: RuntimeExecutionHandle
  readonly nativeSessionId: string
}

interface CachedValue<Value> {
  readonly fingerprint: string
  readonly value: Value
}

export class AcpAdapter implements RuntimeAdapter {
  readonly #transport: AcpTransport
  readonly #adapterVersion: string
  readonly #externalSessionId: (nativeSessionId: string) => string
  readonly #interactionId: (nativeRequestId: number) => string
  readonly #now: () => Date
  readonly #protocolVersion: number
  readonly #externalSessions: AcpExternalSessionsOptions | undefined
  readonly #executions = new Map<string, AcpExecution>()
  readonly #starts = new Map<string, CachedValue<RuntimeExecutionHandle>>()
  readonly #actions = new Map<string, CachedValue<RuntimeExecutionStatus>>()
  readonly #sessionActions = new Map<string, CachedValue<RuntimeSessionResult>>()
  readonly #interactions = new Map<
    string,
    {
      readonly requestId: number
      readonly kind: 'permission' | 'input'
      readonly options?: string[]
    }
  >()
  readonly #nativeByExternalSession = new Map<string, string>()
  readonly #cleaned = new Set<string>()
  #initialize?: z.output<typeof AcpInitializeResultSchema>

  constructor(options: AcpAdapterOptions) {
    this.#transport = options.transport
    this.#adapterVersion = SemanticVersionSchema.parse(options.adapterVersion)
    this.#externalSessionId = options.externalSessionId
    this.#interactionId = options.interactionId
    this.#now = options.now ?? (() => new Date())
    this.#protocolVersion = options.protocolVersion ?? 2
    this.#externalSessions = options.externalSessions
  }

  async inspect(
    requirements?: Parameters<RuntimeAdapter['inspect']>[0]
  ): Promise<RuntimeAdapterInspection> {
    let initialize: z.output<typeof AcpInitializeResultSchema>
    try {
      initialize = await this.#initializeConnection()
    } catch (error) {
      return this.#unavailableInspection(
        error instanceof RuntimeAdapterError ? error.code : 'ACP_INITIALIZATION_FAILED',
        requirements
      )
    }
    const connected = this.#transport.connectionState() === 'connected'
    const versionSupported = initialize.protocolVersion === this.#protocolVersion
    const capabilities = versionSupported
      ? mapAcpCapabilities(
          initialize,
          this.#transport.replay !== undefined && (this.#transport.replaySupport?.() ?? true)
        )
      : []
    const limitations = [
      ...(connected ? [] : ['ACP_DISCONNECTED']),
      ...(versionSupported
        ? []
        : [`ACP_PROTOCOL_VERSION_UNSUPPORTED:${initialize.protocolVersion}`]),
      ...(!initialize.capabilities.session ? ['ACP_SESSION_SURFACE_UNAVAILABLE'] : []),
    ]
    return RuntimeAdapterInspectionSchema.parse({
      metadata: {
        contractVersion: { major: 1, minor: 0 },
        adapterName: 'acp',
        adapterVersion: this.#adapterVersion,
        runtimeFamily: 'acp',
        driverVersion: initialize.capabilities._meta?.controlPlane?.driverVersion ?? '1.0.0',
        harnessVersion: initialize.info.version,
      },
      health:
        connected && versionSupported && initialize.capabilities.session
          ? 'healthy'
          : 'unavailable',
      capabilities,
      limitations,
      observedAt: this.#now().toISOString(),
      ...(requirements
        ? { capabilityEvaluation: inspectRuntimeCapabilities(capabilities, requirements) }
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
      return structuredClone(replay.value)
    }
    const inspection = await this.inspect(request.executionPlan.runtimeRequirements)
    if (inspection.health === 'unavailable' || !inspection.capabilityEvaluation?.eligible) {
      fail('ACP_RUNTIME_INELIGIBLE', 'unsupported', false)
    }
    const sessionResult = z
      .object({ sessionId: NativeSessionIdSchema })
      .strict()
      .parse(await this.#request('session/new', {}))
    const nativeSessionId = sessionResult.sessionId
    const externalSessionId = this.#externalSessionId(nativeSessionId)
    this.#nativeByExternalSession.set(externalSessionId, nativeSessionId)
    await this.#request('session/prompt', {
      sessionId: nativeSessionId,
      prompt: [{ type: 'text', text: acpPrompt(request.attemptId, request.executionPlan) }],
    })
    const handle = RuntimeExecutionHandleSchema.parse({
      handleId: `acp:${request.attemptId}`,
      attemptId: request.attemptId,
      externalSessionId,
      startedAt: this.#now().toISOString(),
    })
    this.#executions.set(handle.handleId, { handle, nativeSessionId })
    this.#starts.set(request.idempotencyKey, { fingerprint, value: handle })
    return structuredClone(handle)
  }

  async *progress(
    handleInput: RuntimeExecutionHandle,
    options: RuntimeProgressOptions = {}
  ): AsyncIterable<RuntimeExecutionProgress> {
    const execution = this.#execution(handleInput)
    let sequence = 0
    for await (const updateInput of this.#transport.updates(
      execution.nativeSessionId,
      options.signal
    )) {
      sequence += 1
      if (sequence <= (options.afterSequence ?? 0)) continue
      const update = AcpUpdateSchema.parse(updateInput)
      const progress = this.#normalizeUpdate(execution, update, sequence)
      if (progress) yield progress
    }
  }

  async submitInput(
    handleInput: RuntimeExecutionHandle,
    requestInput: RuntimeInputRequest
  ): Promise<RuntimeExecutionStatus> {
    const handle = RuntimeExecutionHandleSchema.parse(handleInput)
    const request = RuntimeInputRequestSchema.parse(requestInput)
    return this.#idempotentAction(
      `input:${request.idempotencyKey}`,
      { handle, request },
      async () => {
        const interaction = this.#interactions.get(request.interactionId)
        if (!interaction || interaction.kind !== 'input') {
          fail('ACP_INTERACTION_MISSING', 'validation', false)
        }
        await this.#transport.respond(interaction.requestId, {
          outcome: { outcome: 'submitted', value: request.text },
        })
        return this.status(handle)
      }
    )
  }

  async submitApproval(
    handleInput: RuntimeExecutionHandle,
    requestInput: RuntimeApprovalRequest
  ): Promise<RuntimeExecutionStatus> {
    const handle = RuntimeExecutionHandleSchema.parse(handleInput)
    const request = RuntimeApprovalRequestSchema.parse(requestInput)
    return this.#idempotentAction(
      `approval:${request.idempotencyKey}`,
      { handle, request },
      async () => {
        const interaction = this.#interactions.get(request.interactionId)
        if (!interaction || interaction.kind !== 'permission') {
          fail('ACP_INTERACTION_MISSING', 'validation', false)
        }
        const desired = request.decision === 'approve' ? 'allow_once' : 'reject'
        const optionId = interaction.options?.find((option) => option === desired)
        if (!optionId) fail('ACP_PERMISSION_OPTION_UNSUPPORTED', 'unsupported', false)
        await this.#transport.respond(interaction.requestId, {
          outcome: { outcome: 'selected', optionId },
        })
        return this.status(handle)
      }
    )
  }

  async cancel(
    handleInput: RuntimeExecutionHandle,
    requestInput: RuntimeCancelRequest
  ): Promise<RuntimeExecutionStatus> {
    const execution = this.#execution(handleInput)
    const request = RuntimeCancelRequestSchema.parse(requestInput)
    return this.#idempotentAction(
      `cancel:${request.idempotencyKey}`,
      { handle: execution.handle, request },
      async () => {
        await this.#request('session/cancel', { sessionId: execution.nativeSessionId })
        return this.status(execution.handle)
      }
    )
  }

  async status(handleInput: RuntimeExecutionHandle): Promise<RuntimeExecutionStatus> {
    const execution = this.#execution(handleInput)
    if (this.#transport.connectionState() === 'disconnected') {
      return RuntimeExecutionStatusSchema.parse({
        handle: execution.handle,
        state: 'unknown',
        observedAt: this.#now().toISOString(),
      })
    }
    return normalizeSnapshot(
      execution.handle,
      await this.#transport.snapshot(execution.nativeSessionId)
    )
  }

  reconcile(handle: RuntimeExecutionHandle): Promise<RuntimeExecutionStatus> {
    return this.status(handle)
  }

  async session(operationInput: RuntimeSessionOperation): Promise<RuntimeSessionResult> {
    const operation = RuntimeSessionOperationSchema.parse(operationInput)
    const inspection = await this.inspect()
    const capability = `session.${operation.operation}`
    if (
      !inspection.capabilities.some(
        ({ name, support }) => name === capability && support !== 'unsupported'
      )
    ) {
      fail('CAPABILITY_UNSUPPORTED', 'unsupported', false)
    }
    if (operation.operation === 'create') {
      return this.#idempotentSession(operation.idempotencyKey, operation, async () => {
        await this.#authorizeSession('create')
        const result = z
          .object({ sessionId: NativeSessionIdSchema })
          .parse(await this.#request('session/new', {}))
        await this.#observeNativeSession(result.sessionId, 'created_through_control_plane')
        return this.#sessionResult('create', result.sessionId)
      })
    }
    if (operation.operation === 'list') {
      await this.#authorizeSession('list')
      const result = z
        .object({
          sessions: z.array(
            z
              .object({
                sessionId: NativeSessionIdSchema,
                title: z.string().min(1).max(512).optional(),
              })
              .passthrough()
          ),
        })
        .parse(await this.#request('session/list', {}))
      const observed = new Set<string>()
      for (const native of result.sessions) {
        const session = await this.#observeNativeSession(
          native.sessionId,
          'native_discovery',
          native.title
        )
        observed.add(session.sessionId)
      }
      await this.#markUnlistedSessionsRemoved(observed)
      return RuntimeSessionResultSchema.parse({
        operation: 'list',
        sessions: result.sessions.map(({ sessionId }) =>
          this.#normalizedSession(sessionId, 'active')
        ),
      })
    }
    const { nativeSessionId } = await this.#authorizedSessionReference(
      operation.sessionId,
      operation.operation
    )
    if (operation.operation === 'history') {
      const replay = await this.#replay(nativeSessionId, operation.afterSequence)
      return RuntimeSessionResultSchema.parse({
        operation: 'history',
        session: this.#normalizedSession(nativeSessionId, 'active'),
        completeness: replay.completeness,
        limitations:
          replay.completeness === 'complete'
            ? []
            : [
                replay.completeness === 'partial'
                  ? 'ACP_HISTORY_PARTIAL'
                  : 'ACP_HISTORY_UNAVAILABLE',
              ],
        entries: normalizeHistory(replay.updates, this.#now),
      })
    }
    if (operation.operation === 'load') {
      return this.#idempotentSession(
        operation.idempotencyKey ?? `load:${operation.sessionId}`,
        operation,
        async () => {
          await this.#replay(nativeSessionId)
          await this.#observeNativeSession(nativeSessionId, 'native_discovery')
          return RuntimeSessionResultSchema.parse({
            operation: 'load',
            session: this.#normalizedSession(nativeSessionId, 'active'),
          })
        }
      )
    }
    if (operation.operation === 'resume') {
      return this.#idempotentSession(
        operation.idempotencyKey ?? `resume:${operation.sessionId}`,
        operation,
        async () => {
          await this.#request('session/resume', { sessionId: nativeSessionId })
          await this.#observeNativeSession(nativeSessionId, 'native_discovery')
          return RuntimeSessionResultSchema.parse({
            operation: 'resume',
            session: this.#normalizedSession(nativeSessionId, 'active'),
          })
        }
      )
    }
    return this.#idempotentSession(
      operation.idempotencyKey ?? `close:${operation.sessionId}`,
      operation,
      async () => {
        await this.#request('session/close', { sessionId: nativeSessionId })
        await this.#observeNativeSession(nativeSessionId, 'native_discovery', undefined, 'closed')
        return RuntimeSessionResultSchema.parse({
          operation: 'close',
          session: this.#normalizedSession(nativeSessionId, 'closed'),
        })
      }
    )
  }

  async cleanup(handleInput: RuntimeExecutionHandle): Promise<void> {
    const execution = this.#execution(handleInput)
    if (this.#cleaned.has(execution.handle.handleId)) return
    await this.#transport.cleanup(execution.nativeSessionId)
    this.#cleaned.add(execution.handle.handleId)
  }

  async #initializeConnection(): Promise<z.output<typeof AcpInitializeResultSchema>> {
    if (!this.#initialize) {
      this.#initialize = AcpInitializeResultSchema.parse(
        await this.#request('initialize', {
          protocolVersion: this.#protocolVersion,
          capabilities: {},
          info: { name: 'control-plane', title: 'Control Plane', version: this.#adapterVersion },
        })
      )
    }
    return this.#initialize
  }

  async #request(method: string, params: Record<string, z.util.JSONType>): Promise<unknown> {
    if (this.#transport.connectionState() === 'disconnected') {
      fail('ACP_DISCONNECTED', 'unavailable', true)
    }
    try {
      return await this.#transport.request(method, params)
    } catch (error) {
      if (error instanceof RuntimeAdapterError) throw error
      fail('ACP_TRANSPORT_FAILURE', 'unavailable', true)
    }
  }

  #execution(handleInput: RuntimeExecutionHandle): AcpExecution {
    const handle = RuntimeExecutionHandleSchema.parse(handleInput)
    const execution = this.#executions.get(handle.handleId)
    if (!execution || stable(execution.handle) !== stable(handle)) {
      fail('ACP_EXECUTION_HANDLE_MISSING', 'validation', false)
    }
    return execution
  }

  #normalizeUpdate(
    execution: AcpExecution,
    update: AcpUpdate,
    sequence: number
  ): RuntimeExecutionProgress | undefined {
    const common = {
      handleId: execution.handle.handleId,
      sequence,
      occurredAt: this.#now().toISOString(),
    }
    if (update.sessionUpdate === 'state_update') {
      const state =
        update.state === 'running'
          ? 'running'
          : update.stopReason === 'cancelled'
            ? 'cancelled'
            : 'completed'
      return RuntimeExecutionProgressSchema.parse({ ...common, type: 'status', data: { state } })
    }
    if (
      update.sessionUpdate === 'agent_message' ||
      update.sessionUpdate === 'agent_message_chunk'
    ) {
      return RuntimeExecutionProgressSchema.parse({
        ...common,
        type: 'output',
        data: { text: update.text, messageId: update.messageId },
      })
    }
    if (update.sessionUpdate === 'request_permission') {
      const interactionId = this.#interactionId(update.requestId)
      this.#interactions.set(interactionId, {
        requestId: update.requestId,
        kind: 'permission',
        options: update.options.map(({ kind }) => kind),
      })
      return RuntimeExecutionProgressSchema.parse({
        ...common,
        type: 'interaction',
        data: {
          interactionId,
          kind: 'permission',
          toolCallId: update.toolCallId,
          prompt: update.title,
        },
      })
    }
    if (update.sessionUpdate === 'elicitation') {
      const interactionId = this.#interactionId(update.requestId)
      this.#interactions.set(interactionId, { requestId: update.requestId, kind: 'input' })
      return RuntimeExecutionProgressSchema.parse({
        ...common,
        type: 'interaction',
        data: { interactionId, kind: 'input', prompt: update.prompt },
      })
    }
    if (update.sessionUpdate === 'usage_update') {
      return RuntimeExecutionProgressSchema.parse({
        ...common,
        type: 'usage',
        data: {
          inputTokens: update.inputTokens,
          outputTokens: update.outputTokens,
          durationMs: update.durationMs,
        },
      })
    }
    if (update.sessionUpdate === 'artifact') {
      return RuntimeExecutionProgressSchema.parse({
        ...common,
        type: 'artifact',
        data: { artifact: update.artifact },
      })
    }
    return undefined
  }

  async #idempotentAction(
    key: string,
    input: unknown,
    action: () => Promise<RuntimeExecutionStatus>
  ): Promise<RuntimeExecutionStatus> {
    const fingerprint = stable(input)
    const replay = this.#actions.get(key)
    if (replay) {
      if (replay.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT', 'conflict', false)
      return structuredClone(replay.value)
    }
    const value = RuntimeExecutionStatusSchema.parse(await action())
    this.#actions.set(key, { fingerprint, value })
    return structuredClone(value)
  }

  async #idempotentSession(
    key: string,
    input: unknown,
    action: () => Promise<RuntimeSessionResult>
  ): Promise<RuntimeSessionResult> {
    const fingerprint = stable(input)
    const replay = this.#sessionActions.get(key)
    if (replay) {
      if (replay.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT', 'conflict', false)
      return structuredClone(replay.value)
    }
    const value = RuntimeSessionResultSchema.parse(await action())
    this.#sessionActions.set(key, { fingerprint, value })
    return structuredClone(value)
  }

  async #authorizeSession(
    operation: RuntimeSessionOperation['operation'],
    session?: ExternalSession
  ): Promise<void> {
    if (!this.#externalSessions) return
    if (!(await this.#externalSessions.authorize(operation, session))) {
      fail('ACP_SESSION_UNAUTHORIZED', 'validation', false)
    }
    if (session !== undefined) return
    const connection = RuntimeConnectionSchema.parse(this.#externalSessions.runtimeConnection())
    const connected =
      this.#externalSessions.nodeStatus() === 'online' &&
      !['unavailable', 'disconnected', 'expired', 'revoked'].includes(connection.status) &&
      !['offline', 'reconnecting', 'unknown', 'incompatible', 'revoked'].includes(
        connection.availabilityState ?? 'unknown'
      )
    const advertised = connection.capabilities.some(
      ({ name, support }) => name === `session.${operation}` && support !== 'unsupported'
    )
    if (!connected || !advertised) {
      fail('ACP_SESSION_OPERATION_UNAVAILABLE', 'unavailable', advertised)
    }
  }

  async #authorizedSessionReference(
    externalSessionId: string,
    operation: 'resume' | 'load' | 'close' | 'history'
  ): Promise<{ readonly nativeSessionId: string; readonly session?: ExternalSession }> {
    if (!this.#externalSessions) {
      const nativeSessionId = this.#nativeByExternalSession.get(externalSessionId)
      if (!nativeSessionId) fail('ACP_SESSION_REFERENCE_MISSING', 'validation', false)
      return { nativeSessionId }
    }
    const session = await this.#externalSessions.registry.get(externalSessionId)
    await this.#authorizeSession(operation, session)
    const context = {
      connection: RuntimeConnectionSchema.parse(this.#externalSessions.runtimeConnection()),
      nodeStatus: this.#externalSessions.nodeStatus(),
      evaluatedAt: this.#now().toISOString(),
    }
    const availability = assessExternalSession(session, context).operations[operation]
    if (!availability.available) {
      const retryable = [
        'RUNTIME_MISSING',
        'RUNTIME_OFFLINE',
        'SESSION_CAPABILITIES_STALE',
        'CAPABILITY_NO_LONGER_ADVERTISED',
      ].includes(availability.reason)
      fail('ACP_SESSION_OPERATION_UNAVAILABLE', 'unavailable', retryable)
    }
    const nativeSessionId = await this.#externalSessions.resolveNativeSessionId(
      session.opaqueNativeSessionId
    )
    if (!nativeSessionId) fail('ACP_SESSION_REFERENCE_STALE', 'unavailable', true)
    this.#nativeByExternalSession.set(externalSessionId, nativeSessionId)
    return { nativeSessionId, session }
  }

  async #observeNativeSession(
    nativeSessionId: string,
    origin: 'native_discovery' | 'created_through_control_plane',
    displayName?: string,
    state: 'active' | 'closed' = 'active'
  ) {
    const normalized = this.#normalizedSession(nativeSessionId, state)
    if (!this.#externalSessions) return normalized
    const connection = RuntimeConnectionSchema.parse(this.#externalSessions.runtimeConnection())
    const observedAt = this.#now().toISOString()
    const capabilitySnapshot = {
      version: connection.capabilitySnapshotVersion ?? 1,
      observedAt: connection.capabilitySnapshotObservedAt ?? observedAt,
      expiresAt:
        connection.capabilitySnapshotExpiresAt ??
        new Date(this.#now().getTime() + this.#externalSessions.capabilityTtlMs).toISOString(),
      operations: connection.capabilities
        .filter(({ name, support }) => name.startsWith('session.') && support !== 'unsupported')
        .map(({ name }) => name),
    }
    const existing = await this.#externalSessions.registry.repository.findByNativeIdentity(
      connection.runtimeConnectionId,
      this.#externalSessions.opaqueNativeSessionId(nativeSessionId)
    )
    const safeDisplayName = safeNativeDisplayName(displayName)
    if (!existing) {
      await this.#externalSessions.registry.register({
        externalSessionId: normalized.sessionId,
        runtimeConnectionId: connection.runtimeConnectionId,
        opaqueNativeSessionId: this.#externalSessions.opaqueNativeSessionId(nativeSessionId),
        workspaceId: this.#externalSessions.workspaceId,
        ...(this.#externalSessions.projectId === undefined
          ? {}
          : { projectId: this.#externalSessions.projectId }),
        state,
        ownership: {
          authority: 'external_runtime',
          imported: false,
          concurrentNativeUse: 'allowed',
        },
        capabilitySnapshot,
        safeMetadata: {
          origin,
          ...(safeDisplayName === undefined ? {} : { displayName: safeDisplayName }),
          limitations: [],
        },
        lastObservedAt: observedAt,
      })
      return normalized
    }
    await this.#externalSessions.registry.update({
      externalSessionId: existing.externalSessionId,
      expectedVersion: existing.version,
      observedAt,
      state,
      capabilitySnapshot,
      safeMetadata: {
        ...existing.safeMetadata,
        ...(safeDisplayName === undefined ? {} : { displayName: safeDisplayName }),
      },
    })
    return normalized
  }

  async #markUnlistedSessionsRemoved(observed: ReadonlySet<string>): Promise<void> {
    if (!this.#externalSessions) return
    const connection = RuntimeConnectionSchema.parse(this.#externalSessions.runtimeConnection())
    const sessions = await this.#externalSessions.registry.list({
      workspaceId: this.#externalSessions.workspaceId,
      ...(this.#externalSessions.projectId === undefined
        ? {}
        : { projectId: this.#externalSessions.projectId }),
      runtimeConnectionId: connection.runtimeConnectionId,
    })
    for (const session of sessions) {
      if (session.state !== 'active' || observed.has(session.externalSessionId)) continue
      await this.#externalSessions.registry.update({
        externalSessionId: session.externalSessionId,
        expectedVersion: session.version,
        observedAt: this.#now().toISOString(),
        state: 'removed',
      })
    }
  }

  async #replay(nativeSessionId: string, afterSequence?: number): Promise<AcpSessionReplay> {
    if (!this.#transport.replay) fail('CAPABILITY_UNSUPPORTED', 'unsupported', false)
    return this.#transport.replay(nativeSessionId, {
      ...(afterSequence === undefined ? {} : { afterSequence }),
    })
  }

  #normalizedSession(nativeSessionId: string, state: 'active' | 'closed') {
    const sessionId = this.#externalSessionId(nativeSessionId)
    this.#nativeByExternalSession.set(sessionId, nativeSessionId)
    return { sessionId, state, observedAt: this.#now().toISOString() }
  }

  async #sessionResult(
    operation: 'create',
    nativeSessionId: string
  ): Promise<RuntimeSessionResult> {
    return RuntimeSessionResultSchema.parse({
      operation,
      session: this.#normalizedSession(nativeSessionId, 'active'),
    })
  }

  #unavailableInspection(
    limitation: string,
    requirements?: Parameters<RuntimeAdapter['inspect']>[0]
  ): RuntimeAdapterInspection {
    const capabilities: RuntimeCapability[] = []
    return RuntimeAdapterInspectionSchema.parse({
      metadata: {
        contractVersion: { major: 1, minor: 0 },
        adapterName: 'acp',
        adapterVersion: this.#adapterVersion,
        runtimeFamily: 'acp',
        driverVersion: '0.0.0',
        harnessVersion: '0.0.0',
      },
      health: 'unavailable',
      capabilities,
      limitations: [limitation],
      observedAt: this.#now().toISOString(),
      ...(requirements
        ? { capabilityEvaluation: inspectRuntimeCapabilities(capabilities, requirements) }
        : {}),
    })
  }
}

function mapAcpCapabilities(
  initialize: z.output<typeof AcpInitializeResultSchema>,
  supportsReplay: boolean
) {
  if (!initialize.capabilities.session) return []
  const reported = initialize.capabilities._meta?.controlPlane?.capabilities
  return RuntimeCapabilitySchema.array().parse(
    [
      'execution.cancel',
      'interaction.approval',
      'session.close',
      'session.create',
      'session.list',
      'session.resume',
      ...(supportsReplay ? ['session.history', 'session.load'] : []),
      'stream.events',
      'stream.output',
      'tool.call',
    ]
      .filter(
        (name) => reported === undefined || reported.includes(name as RuntimeCapability['name'])
      )
      .map((name) => ({ name, support: 'supported' as const }))
  )
}

function safeNativeDisplayName(value: string | undefined): string | undefined {
  if (
    value === undefined ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('://') ||
    [...value].some((character) => {
      const code = character.charCodeAt(0)
      return code < 32 || code === 127
    })
  ) {
    return undefined
  }
  return value.slice(0, 128)
}

function normalizeHistory(
  updates: readonly AcpUpdate[],
  now: () => Date
): Array<{ sequence: number; occurredAt: string; data: Record<string, z.util.JSONType> }> {
  return updates.flatMap((update, index) => {
    if (
      update.sessionUpdate !== 'agent_message' &&
      update.sessionUpdate !== 'agent_message_chunk'
    ) {
      return []
    }
    return [
      {
        sequence: index + 1,
        occurredAt: now().toISOString(),
        data: { type: 'output', text: update.text, messageId: update.messageId },
      },
    ]
  })
}

function acpPrompt(attemptId: string, plan: RuntimeExecutionPlanSnapshot): string {
  const contextPackage = z
    .object({ contextPackageId: z.string().min(1).max(512) })
    .passthrough()
    .safeParse(plan['contextPackage'])
  return [
    `Execute Control Plane plan ${plan.executionPlanId}.`,
    `Attempt reference: ${attemptId}.`,
    `Plan digest: ${plan.contentDigest}.`,
    ...(contextPackage.success
      ? [`Authorized context package: ${contextPackage.data.contextPackageId}.`]
      : []),
    'Preserve all native harness-owned behavior, instructions, plugins, tools, and session ownership.',
  ].join(' ')
}

function normalizeSnapshot(handle: RuntimeExecutionHandle, snapshotInput: AcpSnapshot) {
  const snapshot = AcpSnapshotSchema.parse(snapshotInput)
  if (snapshot.state === 'completed') {
    return RuntimeExecutionStatusSchema.parse({
      handle,
      state: 'completed',
      observedAt: snapshot.observedAt,
      result: {
        outcome: 'completed',
        ...(snapshot.output === undefined ? {} : { output: snapshot.output }),
        usage: snapshot.usage,
        artifacts: snapshot.artifacts,
      },
    })
  }
  if (snapshot.state === 'failed' || snapshot.state === 'timed_out') {
    return RuntimeExecutionStatusSchema.parse({
      handle,
      state: snapshot.state,
      observedAt: snapshot.observedAt,
      error: snapshot.error,
    })
  }
  return RuntimeExecutionStatusSchema.parse({
    handle,
    state: snapshot.state,
    observedAt: snapshot.observedAt,
  })
}

export type ReferenceAcpScenario = 'complete' | 'running' | 'timeout'

export interface ReferenceAcpTransportOptions {
  readonly now?: () => string
  readonly protocolVersion?: number
  readonly scenario?: ReferenceAcpScenario
  readonly nativeSessions?: readonly { readonly sessionId: string; readonly title?: string }[]
  readonly historyCompleteness?: AcpSessionReplay['completeness']
  readonly sessionReplay?: boolean
  readonly harnessVersion?: string
}

interface ReferenceSession {
  readonly attemptId: string
  readonly updates: AcpUpdate[]
  snapshot: AcpSnapshot
}

export class ReferenceAcpTransport implements AcpTransport {
  readonly #now: () => string
  readonly #protocolVersion: number
  readonly #scenario: ReferenceAcpScenario
  readonly #historyCompleteness: AcpSessionReplay['completeness']
  readonly #sessionReplay: boolean
  readonly #harnessVersion: string
  readonly #calls: AcpTransportCall[] = []
  readonly #responses: Array<{ requestId: number; result: Record<string, z.util.JSONType> }> = []
  readonly #sessions = new Map<string, ReferenceSession>()
  readonly #nativeSessions = new Map<
    string,
    { readonly sessionId: string; readonly title?: string }
  >()
  readonly #effects = new Map<string, number>()
  #replays = 0
  #state: 'connected' | 'disconnected' = 'connected'

  constructor(options: ReferenceAcpTransportOptions = {}) {
    this.#now = options.now ?? (() => new Date().toISOString())
    this.#protocolVersion = options.protocolVersion ?? 2
    this.#scenario = options.scenario ?? 'complete'
    this.#historyCompleteness = options.historyCompleteness ?? 'complete'
    this.#sessionReplay = options.sessionReplay ?? false
    this.#harnessVersion = SemanticVersionSchema.parse(options.harnessVersion ?? '2.4.0')
    for (const session of options.nativeSessions ?? []) {
      this.#nativeSessions.set(session.sessionId, structuredClone(session))
    }
  }

  connectionState(): 'connected' | 'disconnected' {
    return this.#state
  }

  async request(method: string, params: Record<string, z.util.JSONType>): Promise<unknown> {
    if (this.#state === 'disconnected') throw new Error('ACP_DISCONNECTED')
    this.#calls.push({ method, params: structuredClone(params) })
    if (method === 'initialize') {
      return {
        protocolVersion: this.#protocolVersion,
        capabilities: { session: {} },
        info: {
          name: 'reference-acp-agent',
          title: 'Reference ACP Agent',
          version: this.#harnessVersion,
        },
        authMethods: [{ id: 'native-owned' }],
      }
    }
    if (method === 'session/new') {
      this.#nativeSessions.set('native-session-1', { sessionId: 'native-session-1' })
      return { sessionId: 'native-session-1' }
    }
    if (method === 'session/prompt') {
      const prompt = z
        .object({
          sessionId: NativeSessionIdSchema,
          prompt: z.array(z.object({ type: z.literal('text'), text: z.string() })).min(1),
        })
        .parse(params)
      const attemptId =
        prompt.prompt[0]?.text.match(/att_[0-9A-HJKMNP-TV-Z]{26}/)?.[0] ??
        [...this.#effects.keys()][0] ??
        'att_01JABCDEF0123456789ABCDEFG'
      this.#sessions.set(prompt.sessionId, referenceSession(attemptId, this.#scenario, this.#now()))
      this.#nativeSessions.set(prompt.sessionId, { sessionId: prompt.sessionId })
      this.#effects.set(attemptId, (this.#effects.get(attemptId) ?? 0) + 1)
      return {}
    }
    if (method === 'session/cancel') {
      const sessionId = NativeSessionIdSchema.parse(params['sessionId'])
      const session = this.#session(sessionId)
      session.snapshot = { state: 'cancelled', observedAt: this.#now() }
      return {}
    }
    if (method === 'session/list') {
      return { sessions: [...this.#nativeSessions.values()].map((session) => ({ ...session })) }
    }
    if (method === 'session/resume' || method === 'session/close') {
      const sessionId = NativeSessionIdSchema.parse(params['sessionId'])
      if (!this.#nativeSessions.has(sessionId)) {
        throw new RuntimeAdapterError({
          code: 'ACP_SESSION_NOT_FOUND',
          classification: 'unavailable',
          message: 'ACP session was not found',
          retryable: true,
        })
      }
      return {}
    }
    throw new Error('REFERENCE_ACP_METHOD_UNSUPPORTED')
  }

  async respond(requestId: number, result: Record<string, z.util.JSONType>): Promise<void> {
    this.#responses.push({ requestId, result: structuredClone(result) })
  }

  async *updates(nativeSessionId: string, signal?: AbortSignal): AsyncIterable<AcpUpdate> {
    for (const update of this.#session(nativeSessionId).updates) {
      if (signal?.aborted) return
      yield structuredClone(update)
    }
  }

  async snapshot(nativeSessionId: string): Promise<AcpSnapshot> {
    return structuredClone(this.#session(nativeSessionId).snapshot)
  }

  async cleanup(nativeSessionId: string): Promise<void> {
    this.#session(nativeSessionId)
  }

  async replay(
    nativeSessionId: string,
    options: { readonly afterSequence?: number } = {}
  ): Promise<AcpSessionReplay> {
    if (!this.#nativeSessions.has(nativeSessionId)) {
      throw new RuntimeAdapterError({
        code: 'ACP_SESSION_NOT_FOUND',
        classification: 'unavailable',
        message: 'ACP session was not found',
        retryable: true,
      })
    }
    this.#replays += 1
    const updates: AcpUpdate[] =
      this.#historyCompleteness === 'unavailable'
        ? []
        : [
            {
              sessionUpdate: 'agent_message',
              messageId: 'native-history-message-1',
              text: 'Earlier message',
            },
          ]
    return {
      completeness: this.#historyCompleteness,
      updates: updates.slice(options.afterSequence ?? 0),
    }
  }

  replaySupport(): boolean {
    return this.#sessionReplay
  }

  disconnect(): void {
    this.#state = 'disconnected'
  }

  connect(): void {
    this.#state = 'connected'
  }

  completeAttempt(attemptId: string): void {
    const session = [...this.#sessions.values()].find(
      (candidate) => candidate.attemptId === attemptId
    )
    if (!session) throw new Error('REFERENCE_ACP_SESSION_MISSING')
    session.snapshot = completedSnapshot(this.#now())
  }

  calls(): AcpTransportCall[] {
    return structuredClone(this.#calls)
  }

  responses(): Array<{ requestId: number; result: Record<string, z.util.JSONType> }> {
    return structuredClone(this.#responses)
  }

  effectCount(attemptId: string): number {
    return this.#effects.get(attemptId) ?? 0
  }

  replayCount(): number {
    return this.#replays
  }

  setNativeSessionTitle(nativeSessionId: string, title: string): void {
    const session = this.#nativeSessions.get(nativeSessionId)
    if (!session) throw new Error('REFERENCE_ACP_SESSION_MISSING')
    this.#nativeSessions.set(nativeSessionId, { ...session, title })
  }

  removeNativeSession(nativeSessionId: string): void {
    this.#nativeSessions.delete(nativeSessionId)
  }

  #session(nativeSessionId: string): ReferenceSession {
    const session = this.#sessions.get(nativeSessionId)
    if (!session) throw new Error('REFERENCE_ACP_SESSION_MISSING')
    return session
  }
}

function referenceSession(
  attemptId: string,
  scenario: ReferenceAcpScenario,
  observedAt: string
): ReferenceSession {
  const artifact = RuntimeArtifactReferenceSchema.parse({
    artifactId: 'art_01JABCDEF0123456789ABCDEFG',
    version: 1,
    mediaType: 'application/json',
    digest: `sha256:${'e'.repeat(64)}`,
    sizeBytes: 32,
    locator: 'artifact://acp/result',
  })
  const updates: AcpUpdate[] = [
    { sessionUpdate: 'state_update', state: 'running' },
    {
      sessionUpdate: 'agent_message_chunk',
      messageId: 'native-message-1',
      text: 'ACP working',
    },
    {
      sessionUpdate: 'request_permission',
      requestId: 40,
      toolCallId: 'native-tool-call-1',
      title: 'Allow project read?',
      options: [
        { optionId: 'allow_once', kind: 'allow_once' },
        { optionId: 'reject', kind: 'reject' },
      ],
    },
    {
      sessionUpdate: 'usage_update',
      inputTokens: 12,
      outputTokens: 4,
      durationMs: 120,
    },
    { sessionUpdate: 'artifact', artifact },
    { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' },
  ].map((update) => AcpUpdateSchema.parse(update))
  const snapshot =
    scenario === 'complete'
      ? completedSnapshot(observedAt, artifact)
      : scenario === 'timeout'
        ? AcpSnapshotSchema.parse({
            state: 'timed_out',
            observedAt,
            error: {
              code: 'ACP_PROMPT_TIMED_OUT',
              classification: 'timeout',
              message: 'ACP prompt timed out',
              retryable: true,
            },
          })
        : AcpSnapshotSchema.parse({ state: 'running', observedAt })
  return { attemptId, updates, snapshot }
}

function completedSnapshot(
  observedAt: string,
  artifact = RuntimeArtifactReferenceSchema.parse({
    artifactId: 'art_01JABCDEF0123456789ABCDEFG',
    version: 1,
    mediaType: 'application/json',
    digest: `sha256:${'e'.repeat(64)}`,
    sizeBytes: 32,
    locator: 'artifact://acp/result',
  })
): AcpSnapshot {
  return AcpSnapshotSchema.parse({
    state: 'completed',
    observedAt,
    output: { text: 'ACP complete' },
    usage: { inputTokens: 12, outputTokens: 4, durationMs: 120 },
    artifacts: [artifact],
  })
}

function fail(
  code: string,
  classification: ConstructorParameters<typeof RuntimeAdapterError>[0]['classification'],
  retryable: boolean
): never {
  throw new RuntimeAdapterError({ code, classification, message: code, retryable })
}

function stable(value: unknown): string {
  return JSON.stringify(value)
}

export * from './gateway.js'

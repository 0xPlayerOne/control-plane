import {
  RuntimeAdapterError,
  RuntimeAdapterInspectionSchema,
  RuntimeErrorSchema,
  RuntimeExecutionHandleSchema,
  RuntimeExecutionProgressSchema,
  RuntimeExecutionStatusSchema,
  type RuntimeAdapter,
  type RuntimeExecutionHandle,
  type RuntimeExecutionPlanSnapshot,
  type RuntimeExecutionStatus,
} from './adapter.js'

export const RuntimeAdapterConformanceChecks = Object.freeze([
  'inspection',
  'capabilities',
  'idempotent-start',
  'normalized-error',
  'immutable-plan',
  'progress',
  'status-reconcile',
  'terminal-result',
  'idempotent-cleanup',
] as const)

export interface RuntimeAdapterConformanceInput {
  readonly adapter: RuntimeAdapter
  readonly executionPlan: RuntimeExecutionPlanSnapshot
  readonly attemptId: string
  readonly complete: (
    handle: RuntimeExecutionHandle
  ) => RuntimeExecutionStatus | Promise<RuntimeExecutionStatus>
}

export interface RuntimeAdapterConformanceReport {
  readonly passed: true
  readonly checks: typeof RuntimeAdapterConformanceChecks
}

export async function runRuntimeAdapterConformance(
  input: RuntimeAdapterConformanceInput
): Promise<RuntimeAdapterConformanceReport> {
  RuntimeAdapterInspectionSchema.parse(await input.adapter.inspect())

  const inspection = RuntimeAdapterInspectionSchema.parse(
    await input.adapter.inspect([
      { capability: 'stream.output', necessity: 'required', minimumSupport: 'supported' },
      { capability: 'session.history', necessity: 'optional', minimumSupport: 'degraded' },
    ])
  )
  assert(inspection.capabilityEvaluation?.eligible === true, 'REQUIRED_CAPABILITY_INELIGIBLE')

  const before = fingerprint(input.executionPlan)
  const request = {
    attemptId: input.attemptId,
    idempotencyKey: `conformance:${input.attemptId}`,
    executionPlan: structuredClone(input.executionPlan),
  }
  const first = RuntimeExecutionHandleSchema.parse(await input.adapter.start(request))
  const replay = RuntimeExecutionHandleSchema.parse(await input.adapter.start(request))
  assert(fingerprint(first) === fingerprint(replay), 'START_NOT_IDEMPOTENT')
  let normalizedConflict = false
  try {
    await input.adapter.start({
      ...request,
      executionPlan: {
        ...request.executionPlan,
        contentDigest: `sha256:${'f'.repeat(64)}`,
      },
    })
  } catch (error) {
    if (error instanceof RuntimeAdapterError) {
      RuntimeErrorSchema.parse(error.toJSON())
      normalizedConflict = error.classification === 'conflict' && !error.retryable
    }
  }
  assert(normalizedConflict, 'IDEMPOTENCY_ERROR_NOT_NORMALIZED')
  assert(before === fingerprint(input.executionPlan), 'EXECUTION_PLAN_MUTATED')

  const progress: Array<ReturnType<typeof RuntimeExecutionProgressSchema.parse>> = []
  for await (const eventInput of input.adapter.progress(first, { afterSequence: 0 })) {
    progress.push(RuntimeExecutionProgressSchema.parse(eventInput))
  }
  assert(progress.length > 0, 'PROGRESS_MISSING')
  let previousSequence = 0
  for (const event of progress) {
    assert(event.sequence > previousSequence, 'PROGRESS_NOT_STRICTLY_ORDERED')
    previousSequence = event.sequence
  }

  const status = RuntimeExecutionStatusSchema.parse(await input.adapter.status(first))
  const reconciled = RuntimeExecutionStatusSchema.parse(await input.adapter.reconcile(first))
  assert(fingerprint(status) === fingerprint(reconciled), 'RECONCILIATION_MISMATCH')

  const completed = RuntimeExecutionStatusSchema.parse(await input.complete(first))
  assert(
    completed.state === 'completed' && completed.result?.outcome === 'completed',
    'RESULT_MISSING'
  )

  await input.adapter.cleanup(first)
  await input.adapter.cleanup(first)
  return { passed: true, checks: RuntimeAdapterConformanceChecks }
}

function assert(condition: boolean, code: string): asserts condition {
  if (!condition) throw new Error(`RUNTIME_ADAPTER_CONFORMANCE:${code}`)
}

function fingerprint(value: unknown): string {
  return JSON.stringify(value)
}

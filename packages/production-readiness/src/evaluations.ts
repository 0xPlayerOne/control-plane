import { z } from 'zod'

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const ReferenceSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/)
const VersionSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/)
const TimestampSchema = z.iso.datetime()

export const EvaluationMetricSchema = z.enum([
  'functional_correctness',
  'tool_use',
  'structured_output',
  'latency_ms',
  'cost_usd',
  'policy_compliance',
  'runtime_compatibility',
])

export type EvaluationMetric = z.output<typeof EvaluationMetricSchema>

export const VersionedArtifactSchema = z
  .object({ id: ReferenceSchema, version: VersionSchema, digest: DigestSchema })
  .strict()

export const EvaluationConfigurationSchema = z
  .object({
    executionPlanDigest: DigestSchema,
    profile: VersionedArtifactSchema,
    skills: z.array(VersionedArtifactSchema).max(128),
    graph: VersionedArtifactSchema,
    runtime: VersionedArtifactSchema,
    model: VersionedArtifactSchema,
    tools: z.array(VersionedArtifactSchema).max(128),
    policy: VersionedArtifactSchema,
  })
  .strict()

export const EvalSuiteSchema = z
  .object({
    evalSuiteId: ReferenceSchema,
    version: VersionSchema,
    digest: DigestSchema,
    dataset: VersionedArtifactSchema,
    mode: z.enum(['offline', 'live_provider']),
    cases: z
      .array(
        z
          .object({
            evalCaseId: ReferenceSchema,
            inputDigest: DigestSchema,
            scorers: z
              .array(
                z
                  .object({
                    metric: EvaluationMetricSchema,
                    direction: z.enum(['min', 'max']),
                    threshold: z.number().finite().nonnegative(),
                    required: z.boolean(),
                  })
                  .strict()
              )
              .min(1),
          })
          .strict()
      )
      .min(1),
  })
  .strict()
  .superRefine((suite, context) => {
    if (new Set(suite.cases.map(({ evalCaseId }) => evalCaseId)).size !== suite.cases.length) {
      context.addIssue({ code: 'custom', message: 'Evaluation case identifiers must be unique' })
    }
  })

const MetricValuesSchema = z.partialRecord(
  EvaluationMetricSchema,
  z.number().finite().nonnegative()
)

export const EvalResultSchema = z
  .object({
    evalCaseId: ReferenceSchema,
    dataset: VersionedArtifactSchema,
    configuration: EvaluationConfigurationSchema,
    metrics: MetricValuesSchema,
    failedRequiredMetrics: z.array(EvaluationMetricSchema),
    status: z.enum(['failed', 'passed']),
  })
  .strict()

export const EvalRunSchema = z
  .object({
    evalRunId: ReferenceSchema,
    suite: EvalSuiteSchema,
    configuration: EvaluationConfigurationSchema,
    results: z.array(EvalResultSchema).min(1),
    aggregateMetrics: MetricValuesSchema,
    status: z.enum(['failed', 'passed']),
    startedAt: TimestampSchema,
    completedAt: TimestampSchema,
  })
  .strict()

export type EvalSuite = z.output<typeof EvalSuiteSchema>
export type EvalRun = z.output<typeof EvalRunSchema>
export type EvaluationConfiguration = z.output<typeof EvaluationConfigurationSchema>
export type EvaluationMetricValues = Partial<Record<EvaluationMetric, number>>

export interface EvaluationRepository {
  saveRun(run: EvalRun): Promise<void>
  getRun(evalRunId: string): Promise<EvalRun | undefined>
}

export class InMemoryEvaluationRepository implements EvaluationRepository {
  readonly #runs = new Map<string, EvalRun>()

  async saveRun(run: EvalRun): Promise<void> {
    const parsed = EvalRunSchema.parse(run)
    const existing = this.#runs.get(parsed.evalRunId)
    if (existing && JSON.stringify(existing) !== JSON.stringify(parsed)) {
      throw new Error('EVALUATION_RUN_CONFLICT')
    }
    this.#runs.set(parsed.evalRunId, clone(parsed))
  }

  async getRun(evalRunId: string): Promise<EvalRun | undefined> {
    const run = this.#runs.get(evalRunId)
    return run === undefined ? undefined : clone(run)
  }
}

export class EvaluationService {
  readonly #repository: EvaluationRepository
  readonly #now: () => string

  constructor(options: { readonly repository: EvaluationRepository; readonly now?: () => string }) {
    this.#repository = options.repository
    this.#now = options.now ?? (() => new Date().toISOString())
  }

  async run(input: {
    readonly evalRunId: string
    readonly suite: unknown
    readonly configuration: unknown
    readonly allowLiveProvider?: boolean
    readonly execute: (
      evaluationCase: EvalSuite['cases'][number]
    ) => Promise<EvaluationMetricValues>
  }): Promise<EvalRun> {
    const suite = EvalSuiteSchema.parse(input.suite)
    const configuration = EvaluationConfigurationSchema.parse(input.configuration)
    if (suite.mode === 'live_provider' && input.allowLiveProvider !== true) {
      throw new Error('LIVE_EVALUATION_NOT_AUTHORIZED')
    }
    const startedAt = this.#now()
    const results = []
    for (const evaluationCase of suite.cases) {
      const metrics = MetricValuesSchema.parse(await input.execute(evaluationCase))
      const failedRequiredMetrics = evaluationCase.scorers
        .filter(
          ({ direction, metric, required, threshold }) =>
            required && !passesThreshold(metrics[metric], direction, threshold)
        )
        .map(({ metric }) => metric)
      results.push(
        EvalResultSchema.parse({
          evalCaseId: evaluationCase.evalCaseId,
          dataset: suite.dataset,
          configuration,
          metrics,
          failedRequiredMetrics,
          status: failedRequiredMetrics.length === 0 ? 'passed' : 'failed',
        })
      )
    }
    const run = EvalRunSchema.parse({
      evalRunId: input.evalRunId,
      suite,
      configuration,
      results,
      aggregateMetrics: aggregate(results.map(({ metrics }) => metrics)),
      status: results.every(({ status }) => status === 'passed') ? 'passed' : 'failed',
      startedAt,
      completedAt: this.#now(),
    })
    await this.#repository.saveRun(run)
    return clone(run)
  }
}

function passesThreshold(
  value: number | undefined,
  direction: 'max' | 'min',
  threshold: number
): boolean {
  if (value === undefined) return false
  return direction === 'min' ? value >= threshold : value <= threshold
}

function aggregate(values: readonly EvaluationMetricValues[]): EvaluationMetricValues {
  const totals = new Map<EvaluationMetric, { count: number; total: number }>()
  for (const metrics of values) {
    for (const [metric, value] of Object.entries(metrics) as [EvaluationMetric, number][]) {
      const current = totals.get(metric) ?? { count: 0, total: 0 }
      totals.set(metric, { count: current.count + 1, total: current.total + value })
    }
  }
  return Object.fromEntries(
    [...totals].map(([metric, { count, total }]) => [metric, total / count])
  )
}

function clone<Value>(value: Value): Value {
  return structuredClone(value)
}

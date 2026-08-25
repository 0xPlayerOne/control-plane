import type { EvalRun, EvaluationMetric, EvaluationMetricValues } from './evaluations.js'

export interface ReleaseGateDecision {
  readonly releaseGateId: string
  readonly candidateRunId: string
  readonly baselineRunId: string
  readonly status: 'blocked' | 'passed'
  readonly reasons: readonly string[]
  readonly evaluatedAt: string
}

export interface ReleaseAuditRecord {
  readonly releaseGateId: string
  readonly action: 'promote' | 'rollback'
  readonly actor: string
  readonly fromRunId?: string
  readonly toRunId: string
  readonly reason?: string
  readonly at: string
}

interface GateState {
  readonly candidate: EvalRun
  readonly baseline: EvalRun
  readonly decision: ReleaseGateDecision
  promoted?: EvalRun
}

const lowerIsBetter = new Set<EvaluationMetric>(['latency_ms', 'cost_usd'])

export class ReleaseGateRegistry {
  readonly #now: () => string
  readonly #gates = new Map<string, GateState>()
  readonly #audit: ReleaseAuditRecord[] = []

  constructor(options: { readonly now?: () => string } = {}) {
    this.#now = options.now ?? (() => new Date().toISOString())
  }

  evaluate(input: {
    readonly releaseGateId: string
    readonly candidate: EvalRun
    readonly baseline: EvalRun
    readonly maximumRegressions: EvaluationMetricValues
  }): ReleaseGateDecision {
    const reasons = input.candidate.results.flatMap(({ failedRequiredMetrics }) =>
      failedRequiredMetrics.map((metric) => `REQUIRED_THRESHOLD_FAILED:${metric}`)
    )
    for (const [metric, maximum] of Object.entries(input.maximumRegressions) as [
      EvaluationMetric,
      number,
    ][]) {
      const candidate = input.candidate.aggregateMetrics[metric]
      const baseline = input.baseline.aggregateMetrics[metric]
      if (
        candidate !== undefined &&
        baseline !== undefined &&
        relativeRegression(metric, candidate, baseline) > maximum
      ) {
        reasons.push(`REGRESSION:${metric}`)
      }
    }
    const decision: ReleaseGateDecision = {
      releaseGateId: input.releaseGateId,
      candidateRunId: input.candidate.evalRunId,
      baselineRunId: input.baseline.evalRunId,
      status: reasons.length === 0 ? 'passed' : 'blocked',
      reasons: [...new Set(reasons)].sort(),
      evaluatedAt: this.#now(),
    }
    this.#gates.set(input.releaseGateId, {
      candidate: clone(input.candidate),
      baseline: clone(input.baseline),
      decision,
    })
    return clone(decision)
  }

  promote(releaseGateId: string, actor: string): ReleaseAuditRecord {
    const gate = this.#gate(releaseGateId)
    if (gate.decision.status !== 'passed') throw new Error('RELEASE_GATE_BLOCKED')
    const record: ReleaseAuditRecord = {
      releaseGateId,
      action: 'promote',
      actor,
      ...(gate.promoted === undefined ? {} : { fromRunId: gate.promoted.evalRunId }),
      toRunId: gate.candidate.evalRunId,
      at: this.#now(),
    }
    gate.promoted = clone(gate.candidate)
    this.#audit.push(record)
    return clone(record)
  }

  rollback(releaseGateId: string, actor: string, reason: string): ReleaseAuditRecord {
    const gate = this.#gate(releaseGateId)
    const record: ReleaseAuditRecord = {
      releaseGateId,
      action: 'rollback',
      actor,
      ...(gate.promoted === undefined ? {} : { fromRunId: gate.promoted.evalRunId }),
      toRunId: gate.baseline.evalRunId,
      reason: reason.slice(0, 256),
      at: this.#now(),
    }
    gate.promoted = clone(gate.baseline)
    this.#audit.push(record)
    return clone(record)
  }

  candidate(releaseGateId: string): EvalRun {
    return clone(this.#gate(releaseGateId).candidate)
  }

  promoted(releaseGateId: string): EvalRun | undefined {
    const promoted = this.#gate(releaseGateId).promoted
    return promoted === undefined ? undefined : clone(promoted)
  }

  auditLog(): readonly ReleaseAuditRecord[] {
    return clone(this.#audit)
  }

  #gate(releaseGateId: string): GateState {
    const gate = this.#gates.get(releaseGateId)
    if (!gate) throw new Error('RELEASE_GATE_MISSING')
    return gate
  }
}

function relativeRegression(
  metric: EvaluationMetric,
  candidate: number,
  baseline: number
): number {
  const denominator = Math.max(Math.abs(baseline), Number.EPSILON)
  return lowerIsBetter.has(metric)
    ? Math.max(0, (candidate - baseline) / denominator)
    : Math.max(0, (baseline - candidate) / denominator)
}

function clone<Value>(value: Value): Value {
  return structuredClone(value)
}

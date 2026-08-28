export const failureScenarios = [
  'control_api.before_accept',
  'control_api.after_accept',
  'postgres.transaction_rollback',
  'postgres.connection_loss',
  'postgres.failover',
  'postgres.restore',
  'restate.endpoint_crash',
  'restate.endpoint_redeploy',
  'restate.workflow_replay',
  'runtime_gateway.instance_loss',
  'runtime_gateway.reconnect_storm',
  'runtime_node.disconnect',
  'managed_pi.disconnect',
  'acp.disconnect',
  'provider.outage',
  'provider.partial_response',
  'event.delivery_outage',
  'event.dead_letter_replay',
  'event.duplicate_or_out_of_order',
  'langgraph.worker_interruption',
  'langgraph.checkpoint_interruption',
  'regional_dependency.degradation',
] as const

export type FailureScenario = (typeof failureScenarios)[number]

const knownFailureScenarios = new Set<string>(failureScenarios)

export class ScenarioFailureInjector {
  readonly #remaining = new Map<FailureScenario, number>()

  arm(scenario: FailureScenario, count = 1): void {
    assertFailureScenario(scenario)
    if (!Number.isSafeInteger(count) || count < 1 || count > 100) {
      throw new Error('INVALID_FAILURE_COUNT')
    }
    this.#remaining.set(scenario, count)
  }

  checkpoint(scenario: FailureScenario): void {
    assertFailureScenario(scenario)
    const remaining = this.#remaining.get(scenario) ?? 0
    if (remaining === 0) return
    if (remaining === 1) this.#remaining.delete(scenario)
    else this.#remaining.set(scenario, remaining - 1)
    throw new Error(`INJECTED_FAILURE:${scenario}`)
  }
}

export const productionRecoveryObjectives = {
  executionLedger: { rpoSeconds: 0, rtoSeconds: 300 },
  eventLedger: { rpoSeconds: 0, rtoSeconds: 300 },
  usageLedger: { rpoSeconds: 0, rtoSeconds: 300 },
  postgres: { rpoSeconds: 300, rtoSeconds: 3600 },
  objectStore: { rpoSeconds: 0, rtoSeconds: 3600 },
  replaceableServices: { rpoSeconds: 0, rtoSeconds: 600 },
} as const

type FailurePoint = 'after_commit_before_ack' | 'after_external_effect' | 'before_commit'

interface DurableRecord {
  readonly commandId: string
  readonly payloadDigest: string
  readonly outcome: 'ambiguous' | 'completed'
  readonly effects: number
  readonly charges: number
}

export class DurableFailureHarness {
  readonly #records = new Map<string, DurableRecord>()

  execute(input: {
    readonly commandId: string
    readonly payloadDigest: string
    readonly injectAt?: FailurePoint
  }): { readonly commandId: string; readonly outcome: 'completed'; readonly replayed: boolean } {
    assertInput(input.commandId, input.payloadDigest)
    const existing = this.#records.get(input.commandId)
    if (existing) {
      if (existing.payloadDigest !== input.payloadDigest)
        throw new Error('COMMAND_PAYLOAD_CONFLICT')
      if (existing.outcome === 'ambiguous') throw new Error('RECONCILIATION_REQUIRED')
      return { commandId: existing.commandId, outcome: 'completed', replayed: true }
    }
    if (input.injectAt === 'before_commit') throw injected(input.injectAt)
    if (input.injectAt === 'after_external_effect') {
      this.#records.set(input.commandId, {
        commandId: input.commandId,
        payloadDigest: input.payloadDigest,
        outcome: 'ambiguous',
        effects: 1,
        charges: 0,
      })
      throw injected(input.injectAt)
    }
    this.#records.set(input.commandId, {
      commandId: input.commandId,
      payloadDigest: input.payloadDigest,
      outcome: 'completed',
      effects: 1,
      charges: 1,
    })
    if (input.injectAt === 'after_commit_before_ack') throw injected(input.injectAt)
    return { commandId: input.commandId, outcome: 'completed', replayed: false }
  }

  recover(commandId: string): {
    readonly action: 'reconciliation_required' | 'replay' | 'retry'
    readonly committed: boolean
  } {
    const record = this.#records.get(commandId)
    if (!record) return { action: 'retry', committed: false }
    return {
      action: record.outcome === 'ambiguous' ? 'reconciliation_required' : 'replay',
      committed: true,
    }
  }

  effectCount(commandId: string): number {
    return this.#records.get(commandId)?.effects ?? 0
  }

  chargeCount(commandId: string): number {
    return this.#records.get(commandId)?.charges ?? 0
  }
}

function assertInput(commandId: string, payloadDigest: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(commandId)) {
    throw new Error('INVALID_COMMAND_ID')
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(payloadDigest)) throw new Error('INVALID_PAYLOAD_DIGEST')
}

function assertFailureScenario(scenario: string): asserts scenario is FailureScenario {
  if (!knownFailureScenarios.has(scenario)) throw new Error('UNKNOWN_FAILURE_SCENARIO')
}

function injected(point: FailurePoint): Error {
  return new Error(`INJECTED_FAILURE:${point}`)
}

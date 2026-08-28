import { describe, expect, test } from 'bun:test'
import {
  DurableFailureHarness,
  ScenarioFailureInjector,
  failureScenarios,
  productionRecoveryObjectives,
} from './index.ts'

describe('failure injection and recovery validation', () => {
  test('catalogs every production failure boundary with explicit recovery objectives', () => {
    expect(failureScenarios).toEqual(
      expect.arrayContaining([
        'control_api.before_accept',
        'control_api.after_accept',
        'postgres.transaction_rollback',
        'postgres.connection_loss',
        'postgres.failover',
        'postgres.restore',
        'restate.endpoint_crash',
        'restate.workflow_replay',
        'runtime_gateway.instance_loss',
        'runtime_gateway.reconnect_storm',
        'runtime_node.disconnect',
        'provider.partial_response',
        'event.dead_letter_replay',
        'langgraph.checkpoint_interruption',
      ])
    )
    expect(productionRecoveryObjectives.postgres).toEqual({ rpoSeconds: 300, rtoSeconds: 3600 })
    expect(productionRecoveryObjectives.executionLedger.rpoSeconds).toBe(0)
  })

  test('injects every named production failure through a reusable bounded control', () => {
    const injector = new ScenarioFailureInjector()

    for (const scenario of failureScenarios) {
      injector.arm(scenario)
      expect(() => injector.checkpoint(scenario)).toThrow(`INJECTED_FAILURE:${scenario}`)
      expect(() => injector.checkpoint(scenario)).not.toThrow()
    }
    expect(() => injector.arm('unknown.failure')).toThrow('UNKNOWN_FAILURE_SCENARIO')
    expect(() => injector.arm(failureScenarios[0], 0)).toThrow('INVALID_FAILURE_COUNT')
  })

  test('retries a crash before commit without losing or duplicating durable work', () => {
    const harness = new DurableFailureHarness()

    expect(() =>
      harness.execute({
        commandId: 'command-1',
        payloadDigest: `sha256:${'1'.repeat(64)}`,
        injectAt: 'before_commit',
      })
    ).toThrow('INJECTED_FAILURE:before_commit')
    expect(harness.recover('command-1')).toEqual({ action: 'retry', committed: false })

    expect(
      harness.execute({ commandId: 'command-1', payloadDigest: `sha256:${'1'.repeat(64)}` })
    ).toMatchObject({ outcome: 'completed', replayed: false })
    expect(harness.effectCount('command-1')).toBe(1)
  })

  test('replays a crash after commit without repeating effects or charges', () => {
    const harness = new DurableFailureHarness()

    expect(() =>
      harness.execute({
        commandId: 'command-2',
        payloadDigest: `sha256:${'2'.repeat(64)}`,
        injectAt: 'after_commit_before_ack',
      })
    ).toThrow('INJECTED_FAILURE:after_commit_before_ack')
    expect(harness.recover('command-2')).toEqual({ action: 'replay', committed: true })
    expect(
      harness.execute({ commandId: 'command-2', payloadDigest: `sha256:${'2'.repeat(64)}` })
    ).toMatchObject({ outcome: 'completed', replayed: true })
    expect(harness.effectCount('command-2')).toBe(1)
    expect(harness.chargeCount('command-2')).toBe(1)
  })

  test('routes an ambiguous committed provider outcome to reconciliation', () => {
    const harness = new DurableFailureHarness()

    expect(() =>
      harness.execute({
        commandId: 'command-3',
        payloadDigest: `sha256:${'3'.repeat(64)}`,
        injectAt: 'after_external_effect',
      })
    ).toThrow('INJECTED_FAILURE:after_external_effect')

    expect(harness.recover('command-3')).toEqual({
      action: 'reconciliation_required',
      committed: true,
    })
    expect(harness.effectCount('command-3')).toBe(1)
    expect(harness.chargeCount('command-3')).toBe(0)
  })

  test('fails closed on command identity conflicts after recovery', () => {
    const harness = new DurableFailureHarness()
    harness.execute({ commandId: 'command-4', payloadDigest: `sha256:${'4'.repeat(64)}` })

    expect(() =>
      harness.execute({ commandId: 'command-4', payloadDigest: `sha256:${'5'.repeat(64)}` })
    ).toThrow('COMMAND_PAYLOAD_CONFLICT')
  })
})

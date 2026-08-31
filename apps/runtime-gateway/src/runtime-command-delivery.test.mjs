import { describe, expect, test } from 'bun:test'
import { InMemoryRuntimeCommandRepository } from '@control-plane/domain'
import { ReferenceRuntimeNode } from '@control-plane/runtime-gateway-protocol'
import { golden } from '@control-plane/runtime-gateway-protocol/fixtures'
import { RecordingGatewayMetrics } from './websocket-lifecycle.js'
import {
  RuntimeCommandDeliveryService,
  RuntimePendingCommandDispatcher,
} from './runtime-command-delivery.js'

const command = golden.command
const resultReference = 'art_01JABCDEF0123456789ABCDEFG'

describe('durable Runtime Gateway command delivery', () => {
  test('restarts and redelivers a lost ACK with the same semantic command ID', async () => {
    const repository = new InMemoryRuntimeCommandRepository()
    const firstSender = new RecordingSender()
    const first = service(repository, firstSender)
    await first.enqueue(command)
    await first.deliver(command.commandId, { channelGeneration: 1, sequence: 10 })

    const restartedSender = new RecordingSender()
    const restarted = service(repository, restartedSender)
    const delivery = await restarted.deliver(command.commandId, {
      channelGeneration: 2,
      sequence: 11,
    })

    expect(firstSender.envelopes[0].commandId).toBe(command.commandId)
    expect(restartedSender.envelopes[0].commandId).toBe(command.commandId)
    expect(delivery.record).toMatchObject({
      status: 'dispatched',
      deliveryAttempts: 2,
      lastChannelGeneration: 2,
      lastSequence: 11,
    })
    expect(restarted.metrics.counterValue('runtime_gateway.command_redeliveries')).toBe(1)
  })

  test('uses the RuntimeNode ledger to return the recorded outcome after loss before ACK', async () => {
    const repository = new InMemoryRuntimeCommandRepository()
    const node = new ReferenceRuntimeNode({ now: () => new Date('2026-08-25T12:00:01.000Z') })
    const sender = new NodeSender(node)
    const gateway = service(repository, sender)
    await gateway.enqueue(command)
    await gateway.deliver(command.commandId, { channelGeneration: 1, sequence: 1 })
    const firstOutcome = sender.outcomes.at(-1)

    await gateway.deliver(command.commandId, { channelGeneration: 2, sequence: 2 })
    const replayedOutcome = sender.outcomes.at(-1)
    expect(replayedOutcome.ack.disposition).toBe('replayed')
    expect(replayedOutcome.result).toEqual(firstOutcome.result)
    expect(node.effectCount(command.commandId)).toBe(1)

    await gateway.acknowledge(replayedOutcome.ack)
    const terminal = await gateway.recordResult(replayedOutcome.result, resultReference)
    const duplicateResult = await gateway.recordResult(replayedOutcome.result, resultReference)
    expect(terminal.record.status).toBe('succeeded')
    expect(duplicateResult.duplicate).toBe(true)

    const terminalReplay = await gateway.deliver(command.commandId, {
      channelGeneration: 3,
      sequence: 3,
    })
    expect(terminalReplay.sent).toBe(false)
    expect(terminalReplay.terminalResultReference).toBe(resultReference)
  })

  test('fails closed when a command ID is reused with a different payload hash', async () => {
    const gateway = service(new InMemoryRuntimeCommandRepository(), new RecordingSender())
    await gateway.enqueue(command)

    await expect(
      gateway.enqueue({ ...command, payloadHash: `sha256:${'b'.repeat(64)}` })
    ).rejects.toMatchObject({ code: 'RUNTIME_COMMAND_PAYLOAD_MISMATCH' })
  })

  test('expires queued commands before reconnect and rejects stale channel delivery', async () => {
    const repository = new InMemoryRuntimeCommandRepository()
    const sender = new RecordingSender()
    const gateway = service(repository, sender, '2026-08-25T12:02:00.000Z')
    await gateway.enqueue(command)

    const expired = await gateway.deliver(command.commandId, {
      channelGeneration: 2,
      sequence: 1,
    })
    expect(expired).toMatchObject({ sent: false, record: { status: 'expired' } })
    expect(sender.envelopes).toHaveLength(0)
    expect(gateway.metrics.counterValue('runtime_gateway.command_expiries')).toBe(1)

    const freshGateway = service(repository, sender, '2026-08-25T12:00:30.000Z')
    await expect(
      freshGateway.deliver(command.commandId, { channelGeneration: 1, sequence: 2 })
    ).rejects.toMatchObject({ code: 'RUNTIME_COMMAND_TERMINAL' })
  })

  test('survives loss after ACK and rejects duplicate-result ambiguity', async () => {
    const repository = new InMemoryRuntimeCommandRepository()
    const sender = new RecordingSender()
    let current = new Date('2026-08-25T12:00:01.000Z')
    const first = service(repository, sender, () => current)
    await first.enqueue(command)
    await first.deliver(command.commandId, { channelGeneration: 4, sequence: 7 })
    current = new Date('2026-08-25T12:00:02.000Z')
    await first.acknowledge({ ...golden.ack, sequence: 7, channelGeneration: 4 })

    const restarted = service(repository, sender, () => current)
    await expect(
      restarted.deliver(command.commandId, { channelGeneration: 3, sequence: 9 })
    ).rejects.toMatchObject({ code: 'RUNTIME_COMMAND_STALE_CHANNEL' })
    const result = { ...golden.result, sequence: 8, channelGeneration: 4 }
    await restarted.recordResult(result, resultReference)
    await expect(
      restarted.recordResult({ ...result, status: 'failed' }, resultReference)
    ).rejects.toMatchObject({ code: 'RUNTIME_COMMAND_RESULT_CONFLICT' })

    expect(first.metrics.observations('runtime_gateway.command_ack_latency_ms')).toEqual([1_000])
  })

  test('records bounded inline command outcomes without inventing an Artifact reference', async () => {
    const gateway = service(new InMemoryRuntimeCommandRepository(), new RecordingSender())
    await gateway.enqueue(command)
    await gateway.deliver(command.commandId, { channelGeneration: 1, sequence: 1 })

    const outcome = await gateway.recordResult({ ...golden.result, status: 'failed' })

    expect(outcome.record).toMatchObject({ status: 'failed', resultStatus: 'failed' })
    expect(outcome.record.resultReference).toBeUndefined()
  })

  test('records command-bound error frames once without leaving the command dispatchable', async () => {
    const gateway = service(new InMemoryRuntimeCommandRepository(), new RecordingSender())
    await gateway.enqueue(command)
    await gateway.deliver(command.commandId, { channelGeneration: 1, sequence: 1 })

    const outcome = await gateway.recordError(golden.error)
    const replay = await gateway.recordError(golden.error)

    expect(outcome.record).toMatchObject({ status: 'failed', resultStatus: 'failed' })
    expect(replay.duplicate).toBe(true)
  })

  test('dispatches only newly queued commands on an active node heartbeat', async () => {
    const repository = new InMemoryRuntimeCommandRepository()
    const sender = new RecordingSender()
    const delivery = service(repository, sender)
    await delivery.enqueue(command)
    await delivery.enqueue({
      ...command,
      commandId: 'cmd_01JBBCDEF0123456789ABCDEFG',
      idempotencyKey: 'runtime-command-second',
    })
    const dispatcher = new RuntimePendingCommandDispatcher({
      repository,
      delivery,
      now: () => new Date('2026-08-25T12:00:01.000Z'),
    })
    const source = {
      nodeId: command.nodeId,
      workspaceId: command.workspaceId,
      gatewayInstanceId: 'gateway-a',
      connectionId: 'connection-a',
      channelGeneration: 3,
      protocolVersion: command.protocolVersion,
      connectedAt: '2026-08-25T12:00:00.000Z',
      lastHeartbeatAt: '2026-08-25T12:00:01.000Z',
    }

    expect(await dispatcher.dispatch(source, 12)).toBe(2)
    expect(sender.envelopes.map(({ sequence }) => sequence)).toEqual([12, 13])
    expect(await dispatcher.dispatch(source, 14)).toBe(0)
  })
})

function service(repository, sender, now = '2026-08-25T12:00:01.000Z') {
  const metrics = new RecordingGatewayMetrics()
  const gateway = new RuntimeCommandDeliveryService({
    repository,
    sender,
    metrics,
    now: typeof now === 'function' ? now : () => new Date(now),
  })
  return Object.assign(gateway, { metrics })
}

class RecordingSender {
  envelopes = []

  async send(envelope) {
    this.envelopes.push(envelope)
  }
}

class NodeSender extends RecordingSender {
  outcomes = []

  constructor(node) {
    super()
    this.node = node
  }

  async send(envelope) {
    await super.send(envelope)
    this.outcomes.push(this.node.receive(envelope))
  }
}

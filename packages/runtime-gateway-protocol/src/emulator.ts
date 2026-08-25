import {
  GatewayCommandEnvelopeSchema,
  GatewayEnvelopeSchema,
  GatewayProtocolManifest,
  negotiateGatewayProtocolVersion,
  type GatewayAcknowledgementEnvelope,
  type GatewayCommandEnvelope,
  type GatewayResultEnvelope,
} from './protocol.js'
import { inventoryFixtures } from './fixtures.js'

interface RecordedOutcome {
  readonly payloadHash: string
  readonly result: GatewayResultEnvelope
}

export interface ReferenceRuntimeNodeOptions {
  readonly maxLedgerEntries?: number
  readonly now?: () => Date
}

export class GatewayProtocolError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'GatewayProtocolError'
  }
}

export class ReferenceRuntimeNode {
  readonly #effects = new Map<string, number>()
  readonly #ledger = new Map<string, RecordedOutcome>()
  readonly #maxLedgerEntries: number
  readonly #now: () => Date
  #lastObservedSequence = 0

  constructor(options: ReferenceRuntimeNodeOptions = {}) {
    const maxLedgerEntries = options.maxLedgerEntries ?? 10_000
    if (!Number.isSafeInteger(maxLedgerEntries) || maxLedgerEntries <= 0) {
      throw new GatewayProtocolError('INVALID_LEDGER_CAPACITY')
    }
    this.#maxLedgerEntries = maxLedgerEntries
    this.#now = options.now ?? (() => new Date())
  }

  observe(envelopeValue: unknown): string {
    const envelope = GatewayEnvelopeSchema.parse(envelopeValue)
    this.#lastObservedSequence = Math.max(this.#lastObservedSequence, envelope.sequence)
    return envelope.type
  }

  lastObservedSequence(): number {
    return this.#lastObservedSequence
  }

  receive(commandValue: unknown): {
    readonly ack: GatewayAcknowledgementEnvelope
    readonly result?: GatewayResultEnvelope
  } {
    const command = GatewayCommandEnvelopeSchema.parse(commandValue)
    const recorded = this.#ledger.get(command.commandId)
    if (recorded !== undefined) {
      if (recorded.payloadHash !== command.payloadHash) {
        throw new GatewayProtocolError('COMMAND_PAYLOAD_MISMATCH')
      }
      return { ack: this.#ack(command, 'replayed'), result: structuredClone(recorded.result) }
    }
    if (Date.parse(command.expiresAt) <= this.#now().getTime()) {
      return { ack: this.#ack(command, 'expired') }
    }
    if (this.#ledger.size >= this.#maxLedgerEntries) {
      throw new GatewayProtocolError('COMMAND_LEDGER_CAPACITY_EXCEEDED')
    }

    const result = this.#result(command)
    this.#effects.set(command.commandId, 1)
    this.#ledger.set(command.commandId, { payloadHash: command.payloadHash, result })
    return { ack: this.#ack(command, 'accepted'), result: structuredClone(result) }
  }

  effectCount(commandId: string): number {
    return this.#effects.get(commandId) ?? 0
  }

  #ack(
    command: GatewayCommandEnvelope,
    disposition: GatewayAcknowledgementEnvelope['disposition']
  ): GatewayAcknowledgementEnvelope {
    return {
      type: 'ack',
      schemaVersion: 1,
      protocolVersion: command.protocolVersion,
      sequence: command.sequence,
      nodeId: command.nodeId,
      workspaceId: command.workspaceId,
      traceId: command.traceId,
      sentAt: this.#now().toISOString(),
      channelGeneration: command.channelGeneration,
      commandId: command.commandId,
      payloadHash: command.payloadHash,
      disposition,
    }
  }

  #result(command: GatewayCommandEnvelope): GatewayResultEnvelope {
    return {
      type: 'result',
      schemaVersion: 1,
      protocolVersion: command.protocolVersion,
      sequence: command.sequence + 1,
      nodeId: command.nodeId,
      workspaceId: command.workspaceId,
      traceId: command.traceId,
      sentAt: this.#now().toISOString(),
      channelGeneration: command.channelGeneration,
      commandId: command.commandId,
      payloadHash: command.payloadHash,
      status: 'succeeded',
      completedAt: this.#now().toISOString(),
      result: { data: { outcome: 'reference-complete' } },
    }
  }
}

export function runGatewayProtocolConformance(): { readonly scenarios: 9; readonly passed: 9 } {
  const command = conformanceCommand()
  const node = new ReferenceRuntimeNode({ now: () => new Date('2026-08-25T12:00:01.000Z') })
  const first = node.receive(command)
  const replay = node.receive(command)
  const checks = [
    GatewayEnvelopeSchema.safeParse(command).success,
    negotiateGatewayProtocolVersion(GatewayProtocolManifest.supported, [{ major: 1, minor: 0 }])
      ?.major === 1,
    first.ack.disposition === 'accepted',
    replay.ack.disposition === 'replayed',
    node.effectCount(command.commandId) === 1,
    inventoryFixtures.noProvider.contextProviders.length === 0,
    inventoryFixtures.cortanaCompatible.contextProviders.length === 1,
    inventoryFixtures.alternateProvider.contextProviders.length === 1,
    GatewayEnvelopeSchema.safeParse({ ...command, operation: 'pi.command' }).success === false,
  ]
  if (checks.some((check) => !check)) throw new GatewayProtocolError('CONFORMANCE_FAILED')
  return { scenarios: 9, passed: 9 }
}

function conformanceCommand() {
  return {
    type: 'command' as const,
    schemaVersion: 1 as const,
    protocolVersion: { major: 1, minor: 0 },
    sequence: 1,
    nodeId: 'rnr_01JABCDEF0123456789ABCDEFG',
    workspaceId: 'wsp_01JABCDEF0123456789ABCDEFG',
    traceId: 'trc_01JABCDEF0123456789ABCDEFG',
    sentAt: '2026-08-25T12:00:00.000Z',
    channelGeneration: 1,
    commandId: 'cmd_01JABCDEF0123456789ABCDEFG',
    idempotencyKey: 'conformance:01JABCDEF0123456789ABCDEFG',
    payloadHash: `sha256:${'a'.repeat(64)}`,
    issuedAt: '2026-08-25T12:00:00.000Z',
    expiresAt: '2026-08-25T12:01:00.000Z',
    family: 'runtime' as const,
    operation: 'runtime.execute' as const,
    driver: { family: 'reference-runtime', version: '1.0.0' },
    runtimeConnectionId: 'rtc_01JABCDEF0123456789ABCDEFG',
    executionId: 'exe_01JABCDEF0123456789ABCDEFG',
    attemptId: 'att_01JABCDEF0123456789ABCDEFG',
    requiredCapabilities: ['runtime.execute'],
    payload: { version: 1, parameters: { fixture: true } },
  }
}

import type { HostEncryptionPublicKey } from './crypto.js'
import { encryptRelayReturnPayload } from './crypto.js'
import { HostEncryptionKeyRing } from './keyring.js'
import type {
  OpaqueRelayRecord,
  RelayCommandResult,
  RelayHostCommandProcessor,
  RelayMetadataCommandProcessor,
  RelayMetadataRecord,
} from './relay.js'
import type { EncryptedRelayEnvelope, RelayStatusProjection } from './protocol.js'

export interface OutboundOpaqueRelayClient {
  register(key: HostEncryptionPublicKey): void | Promise<void>
  revoke(hostId: string, keyId: string): void | Promise<void>
  pull(
    hostId: string,
    limit?: number
  ): readonly OpaqueRelayRecord[] | Promise<readonly OpaqueRelayRecord[]>
  acknowledge(deliveryId: string): void | Promise<void>
  pullMetadata(
    hostId: string,
    limit?: number
  ): readonly RelayMetadataRecord[] | Promise<readonly RelayMetadataRecord[]>
  acknowledgeMetadata(deliveryId: string): void | Promise<void>
  publishResult(envelope: EncryptedRelayEnvelope): void | Promise<void>
  publishProjection(projection: RelayStatusProjection): void | Promise<void>
  health(): Promise<boolean>
}

export interface RemoteControlHostAdapterOptions<Result> {
  readonly workspaceId: string
  readonly hostId: string
  readonly keys: HostEncryptionKeyRing
  readonly relay: OutboundOpaqueRelayClient
  readonly commands: RelayHostCommandProcessor<Result>
  readonly metadataCommands?: RelayMetadataCommandProcessor<unknown>
  readonly encodeResult?: (result: Result) => Uint8Array
  readonly now?: () => Date
  readonly pullLimit?: number
  readonly pollIntervalMs?: number
}

export interface RemoteControlPollResult {
  readonly delivered: number
  readonly accepted: number
  readonly duplicates: number
  readonly rejected: number
  readonly deferred: number
}

export class RemoteControlHostAdapter<Result> {
  readonly #workspaceId: string
  readonly #hostId: string
  readonly #keys: HostEncryptionKeyRing
  readonly #relay: OutboundOpaqueRelayClient
  readonly #commands: RelayHostCommandProcessor<Result>
  readonly #metadataCommands: RelayMetadataCommandProcessor<unknown> | undefined
  readonly #encodeResult: ((result: Result) => Uint8Array) | undefined
  readonly #now: () => Date
  readonly #pullLimit: number
  readonly #pollIntervalMs: number
  #pollTimer: ReturnType<typeof setTimeout> | undefined
  #pollInFlight: Promise<RemoteControlPollResult> | undefined
  #started = false

  constructor(options: RemoteControlHostAdapterOptions<Result>) {
    if (options.keys.hostId !== options.hostId || options.commands.hostId !== options.hostId) {
      throw new Error('REMOTE_CONTROL_HOST_MISMATCH')
    }
    if (options.commands.workspaceId !== options.workspaceId) {
      throw new Error('REMOTE_CONTROL_WORKSPACE_MISMATCH')
    }
    this.#workspaceId = options.workspaceId
    this.#hostId = options.hostId
    this.#keys = options.keys
    this.#relay = options.relay
    this.#commands = options.commands
    this.#metadataCommands = options.metadataCommands
    this.#encodeResult = options.encodeResult
    this.#now = options.now ?? (() => new Date())
    this.#pullLimit = options.pullLimit ?? 100
    this.#pollIntervalMs = options.pollIntervalMs ?? 1_000
    if (!Number.isSafeInteger(this.#pollIntervalMs) || this.#pollIntervalMs < 100) {
      throw new Error('REMOTE_CONTROL_POLL_INTERVAL_INVALID')
    }
  }

  async start(): Promise<void> {
    if (this.#started) throw new Error('REMOTE_CONTROL_ALREADY_STARTED')
    await this.#relay.register(this.#keys.active())
    this.#started = true
    this.#schedulePoll()
  }

  async rotate(graceMs?: number): Promise<HostEncryptionPublicKey> {
    this.#assertStarted()
    const key = await this.#keys.rotate(this.#now(), graceMs)
    await this.#relay.register(key)
    return key
  }

  async revoke(keyId: string): Promise<void> {
    this.#assertStarted()
    await this.#relay.revoke(this.#hostId, keyId)
    this.#keys.revoke(keyId)
  }

  async poll(): Promise<RemoteControlPollResult> {
    this.#assertStarted()
    const active = this.#pollInFlight
    if (active !== undefined) return active
    const operation = this.#pollOnce()
    this.#pollInFlight = operation
    try {
      return await operation
    } finally {
      if (this.#pollInFlight === operation) this.#pollInFlight = undefined
    }
  }

  async #pollOnce(): Promise<RemoteControlPollResult> {
    const metadataCommands = this.#metadataCommands
    const [records, metadata] = await Promise.all([
      this.#relay.pull(this.#hostId, this.#pullLimit),
      metadataCommands === undefined
        ? Promise.resolve([] as readonly RelayMetadataRecord[])
        : this.#relay.pullMetadata(this.#hostId, this.#pullLimit),
    ])
    let accepted = 0
    let duplicates = 0
    let rejected = 0
    let deferred = 0
    for (const record of records) {
      await this.#project(record.commandId, 'received')
      try {
        const result = await this.#commands.process(record.envelope, this.#now())
        if (result.outcome === 'accepted') accepted += 1
        else duplicates += 1
        await this.#publishEncryptedResult(record, result.result)
        await this.#project(record.commandId, 'accepted')
        await this.#relay.acknowledge(record.deliveryId)
      } catch (error) {
        if (isPermanentRejection(error)) {
          rejected += 1
          await this.#project(record.commandId, 'rejected', error.code)
          await this.#relay.acknowledge(record.deliveryId)
        } else {
          deferred += 1
          await this.#project(record.commandId, 'unknown', 'OUTCOME_UNKNOWN')
        }
      }
    }
    if (metadataCommands !== undefined) {
      for (const record of metadata) {
        await this.#project(record.commandId, 'received')
        try {
          const result = await metadataCommands.process(record.command, this.#now())
          if (result.outcome === 'accepted') accepted += 1
          else duplicates += 1
          await this.#project(record.commandId, metadataProjectionState(result.result))
          await this.#relay.acknowledgeMetadata(record.deliveryId)
        } catch (error) {
          if (isPermanentRejection(error)) {
            rejected += 1
            await this.#project(record.commandId, 'rejected', error.code)
            await this.#relay.acknowledgeMetadata(record.deliveryId)
          } else {
            deferred += 1
            await this.#project(record.commandId, 'unknown', 'OUTCOME_UNKNOWN')
          }
        }
      }
    }
    return {
      delivered: records.length + metadata.length,
      accepted,
      duplicates,
      rejected,
      deferred,
    }
  }

  async health(): Promise<{
    readonly ready: boolean
    readonly component: 'remote-control-relay'
    readonly version: '1'
    readonly details: { readonly direction: 'outbound'; readonly listener: false }
  }> {
    return {
      ready: this.#started && (await this.#relay.health()),
      component: 'remote-control-relay',
      version: '1',
      details: { direction: 'outbound', listener: false },
    }
  }

  async stop(): Promise<void> {
    this.#started = false
    if (this.#pollTimer !== undefined) clearTimeout(this.#pollTimer)
    this.#pollTimer = undefined
    await this.#pollInFlight?.catch(() => undefined)
  }

  #schedulePoll(): void {
    if (!this.#started) return
    this.#pollTimer = setTimeout(() => {
      this.#pollTimer = undefined
      void this.poll()
        .catch(() => undefined)
        .finally(() => this.#schedulePoll())
    }, this.#pollIntervalMs)
    this.#pollTimer.unref?.()
  }

  async #publishEncryptedResult(record: OpaqueRelayRecord, result: Result): Promise<void> {
    const envelope = record.envelope
    if (
      this.#encodeResult === undefined ||
      envelope.returnKeyId === undefined ||
      envelope.returnPublicKey === undefined
    ) {
      return
    }
    const plaintext = new Uint8Array(this.#encodeResult(result))
    try {
      const response = await encryptRelayReturnPayload({
        hostId: this.#hostId,
        recipient: { keyId: envelope.returnKeyId, publicKey: envelope.returnPublicKey },
        workspaceId: this.#workspaceId,
        commandId: envelope.commandId,
        payloadType:
          envelope.payloadType === 'submit_input' ? 'interaction_result' : 'execution_result',
        payloadSchemaVersion: 1,
        issuedAt: this.#now().toISOString(),
        expiresAt: envelope.expiresAt,
        plaintext,
      })
      await this.#relay.publishResult(response)
    } finally {
      plaintext.fill(0)
    }
  }

  async #project(
    commandId: string,
    state: RelayStatusProjection['state'],
    reasonCode?: string
  ): Promise<void> {
    await this.#relay.publishProjection({
      schemaVersion: 1,
      workspaceId: this.#workspaceId,
      hostId: this.#hostId,
      commandId,
      state,
      ...(reasonCode === undefined ? {} : { reasonCode }),
      occurredAt: this.#now().toISOString(),
    })
  }

  #assertStarted(): void {
    if (!this.#started) throw new Error('REMOTE_CONTROL_NOT_STARTED')
  }
}

function isPermanentRejection(
  error: unknown
): error is Error & { readonly code: `RELAY_${string}` } {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('RELAY_')
  )
}

function metadataProjectionState(result: unknown): RelayStatusProjection['state'] {
  if (typeof result !== 'object' || result === null) return 'accepted'
  const state: unknown = Reflect.get(result, 'state')
  return state === 'running' ||
    state === 'waiting' ||
    state === 'completed' ||
    state === 'cancelled' ||
    state === 'failed' ||
    state === 'unknown'
    ? state
    : 'accepted'
}

export type { RelayCommandResult }

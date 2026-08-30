import type { HostEncryptionPublicKey } from './crypto.js'
import { HostEncryptionKeyRing } from './keyring.js'
import type { OpaqueRelayRecord, RelayCommandResult, RelayHostCommandProcessor } from './relay.js'
import type { RelayStatusProjection } from './protocol.js'

export interface OutboundOpaqueRelayClient {
  register(key: HostEncryptionPublicKey): void | Promise<void>
  revoke(hostId: string, keyId: string): void | Promise<void>
  pull(
    hostId: string,
    limit?: number
  ): readonly OpaqueRelayRecord[] | Promise<readonly OpaqueRelayRecord[]>
  acknowledge(deliveryId: string): void | Promise<void>
  publishProjection(projection: RelayStatusProjection): void | Promise<void>
  health(): Promise<boolean>
}

export interface RemoteControlHostAdapterOptions<Result> {
  readonly workspaceId: string
  readonly hostId: string
  readonly keys: HostEncryptionKeyRing
  readonly relay: OutboundOpaqueRelayClient
  readonly commands: RelayHostCommandProcessor<Result>
  readonly now?: () => Date
  readonly pullLimit?: number
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
  readonly #now: () => Date
  readonly #pullLimit: number
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
    this.#now = options.now ?? (() => new Date())
    this.#pullLimit = options.pullLimit ?? 100
  }

  async start(): Promise<void> {
    if (this.#started) throw new Error('REMOTE_CONTROL_ALREADY_STARTED')
    await this.#relay.register(this.#keys.active())
    this.#started = true
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
    const records = await this.#relay.pull(this.#hostId, this.#pullLimit)
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
    return { delivered: records.length, accepted, duplicates, rejected, deferred }
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

  stop(): void {
    this.#started = false
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

export type { RelayCommandResult }

import {
  decryptRelayPayload,
  RelayEnvelopeError,
  sha256,
  type HostEncryptionKeyPair,
  type HostEncryptionPublicKey,
} from './crypto.js'
import {
  EncryptedRelayEnvelopeSchema,
  MAX_RELAY_CLOCK_SKEW_MS,
  MAX_RELAY_ENVELOPE_LIFETIME_MS,
  RelayMetadataCommandSchema,
  RelayStatusProjectionSchema,
  type EncryptedRelayEnvelope,
  type RelayMetadataCommand,
  type RelayStatusProjection,
} from './protocol.js'

export interface OpaqueRelayRecord {
  readonly deliveryId: string
  readonly hostId: string
  readonly workspaceId: string
  readonly commandId: string
  readonly receivedAt: string
  readonly envelope: EncryptedRelayEnvelope
  readonly attempts: number
  readonly acknowledged: boolean
}

export class FakeOpaqueRelay {
  readonly #records = new Map<string, OpaqueRelayRecord>()
  readonly #registrations = new Map<string, HostEncryptionPublicKey>()
  readonly #projections: RelayStatusProjection[] = []
  #sequence = 0

  publish(envelopeInput: EncryptedRelayEnvelope, receivedAt: Date = new Date()): OpaqueRelayRecord {
    const envelope = EncryptedRelayEnvelopeSchema.parse(envelopeInput)
    const duplicate = [...this.#records.values()].find(
      (record) =>
        record.hostId === envelope.hostId &&
        record.workspaceId === envelope.workspaceId &&
        record.commandId === envelope.commandId
    )
    if (duplicate !== undefined) {
      if (JSON.stringify(duplicate.envelope) !== JSON.stringify(envelope)) {
        throw new Error('RELAY_COMMAND_CONFLICT')
      }
      return duplicate
    }
    this.#sequence += 1
    const record = {
      deliveryId: `delivery-${this.#sequence}`,
      hostId: envelope.hostId,
      workspaceId: envelope.workspaceId,
      commandId: envelope.commandId,
      receivedAt: receivedAt.toISOString(),
      envelope,
      attempts: 0,
      acknowledged: false,
    }
    this.#records.set(record.deliveryId, record)
    return record
  }

  pull(hostId: string, limit = 100): readonly OpaqueRelayRecord[] {
    return [...this.#records.values()]
      .filter((record) => record.hostId === hostId && !record.acknowledged)
      .slice(0, limit)
      .map((record) => {
        const delivered = { ...record, attempts: record.attempts + 1 }
        this.#records.set(record.deliveryId, delivered)
        return delivered
      })
  }

  acknowledge(deliveryId: string): void {
    const record = this.#records.get(deliveryId)
    if (record !== undefined) this.#records.set(deliveryId, { ...record, acknowledged: true })
  }

  snapshot(): string {
    return JSON.stringify({
      registrations: [...this.#registrations.values()],
      records: [...this.#records.values()],
      projections: this.#projections,
    })
  }

  register(key: HostEncryptionPublicKey): void {
    const existing = this.#registrations.get(key.hostId)
    if (existing !== undefined && existing.keyId === key.keyId) return
    this.#registrations.set(key.hostId, { ...key })
  }

  revoke(hostId: string, keyId: string): void {
    const registered = this.#registrations.get(hostId)
    if (registered?.keyId === keyId) this.#registrations.delete(hostId)
  }

  registration(hostId: string): HostEncryptionPublicKey | undefined {
    return this.#registrations.get(hostId)
  }

  publishProjection(input: RelayStatusProjection): void {
    this.#projections.push(RelayStatusProjectionSchema.parse(input))
  }

  projections(): readonly RelayStatusProjection[] {
    return this.#projections.map((projection) => ({ ...projection }))
  }

  health(): Promise<boolean> {
    return Promise.resolve(true)
  }
}

export interface RelayCommandResult<Result> {
  readonly outcome: 'accepted' | 'duplicate'
  readonly commandId: string
  readonly payloadDigest: `sha256:${string}`
  readonly result: Result
}

export interface RelayCommandResultRepository<Result> {
  get(commandId: string): Promise<RelayCommandResult<Result> | undefined>
  put(result: RelayCommandResult<Result>): Promise<void>
}

export interface RelayHostCommandProcessor<Result> {
  readonly hostId: string
  readonly workspaceId: string
  process(envelope: EncryptedRelayEnvelope, now?: Date): Promise<RelayCommandResult<Result>>
}

export class InMemoryRelayCommandResultRepository<
  Result,
> implements RelayCommandResultRepository<Result> {
  readonly #results = new Map<string, RelayCommandResult<Result>>()

  get(commandId: string): Promise<RelayCommandResult<Result> | undefined> {
    return Promise.resolve(this.#results.get(commandId))
  }

  put(result: RelayCommandResult<Result>): Promise<void> {
    if (this.#results.has(result.commandId)) throw new Error('RELAY_COMMAND_ALREADY_RECORDED')
    this.#results.set(result.commandId, result)
    return Promise.resolve()
  }
}

export class RelayCommandProcessor<Result> implements RelayHostCommandProcessor<Result> {
  readonly #inFlight = new Map<
    string,
    { readonly envelope: string; readonly operation: Promise<RelayCommandResult<Result>> }
  >()

  constructor(
    readonly hostId: string,
    readonly workspaceId: string,
    readonly keyResolver: (keyId: string, now: Date) => HostEncryptionKeyPair,
    readonly repository: RelayCommandResultRepository<Result>,
    readonly accept: (envelope: EncryptedRelayEnvelope, plaintext: Uint8Array) => Promise<Result>
  ) {}

  async process(
    envelopeInput: EncryptedRelayEnvelope,
    now: Date = new Date()
  ): Promise<RelayCommandResult<Result>> {
    const envelope = EncryptedRelayEnvelopeSchema.parse(envelopeInput)
    const inFlight = this.#inFlight.get(envelope.commandId)
    if (inFlight !== undefined) {
      if (inFlight.envelope !== JSON.stringify(envelope)) throw new Error('RELAY_COMMAND_CONFLICT')
      const result = await inFlight.operation
      return { ...result, outcome: 'duplicate' }
    }
    const operation = this.#processOnce(envelope, now)
    this.#inFlight.set(envelope.commandId, { envelope: JSON.stringify(envelope), operation })
    try {
      return await operation
    } finally {
      this.#inFlight.delete(envelope.commandId)
    }
  }

  async #processOnce(
    envelope: EncryptedRelayEnvelope,
    now: Date
  ): Promise<RelayCommandResult<Result>> {
    const key = this.keyResolver(envelope.keyId, now)
    const plaintext = await decryptRelayPayload({
      envelope,
      recipient: key,
      expectedHostId: this.hostId,
      expectedWorkspaceId: this.workspaceId,
      now,
    })
    try {
      const payloadDigest = await sha256(plaintext)
      const replay = await this.repository.get(envelope.commandId)
      if (replay !== undefined) {
        if (replay.payloadDigest !== payloadDigest) throw new Error('RELAY_COMMAND_CONFLICT')
        return { ...replay, outcome: 'duplicate' }
      }
      const result = await this.accept(envelope, plaintext)
      const accepted = {
        outcome: 'accepted' as const,
        commandId: envelope.commandId,
        payloadDigest,
        result,
      }
      await this.repository.put(accepted)
      return accepted
    } finally {
      plaintext.fill(0)
    }
  }
}

export interface RelayMetadataCommandResult<Result> {
  readonly outcome: 'accepted' | 'duplicate'
  readonly commandId: string
  readonly result: Result
}

export class RelayMetadataCommandProcessor<Result> {
  readonly #results = new Map<
    string,
    { readonly command: string; readonly result: RelayMetadataCommandResult<Result> }
  >()
  readonly #inFlight = new Map<
    string,
    { readonly command: string; readonly operation: Promise<RelayMetadataCommandResult<Result>> }
  >()

  constructor(
    readonly hostId: string,
    readonly workspaceId: string,
    readonly accept: (command: RelayMetadataCommand) => Promise<Result>
  ) {}

  async process(
    commandInput: RelayMetadataCommand,
    now: Date = new Date()
  ): Promise<RelayMetadataCommandResult<Result>> {
    const command = RelayMetadataCommandSchema.parse(commandInput)
    if (command.hostId !== this.hostId || command.workspaceId !== this.workspaceId) {
      throw new Error('RELAY_COMMAND_SCOPE_MISMATCH')
    }
    const issued = Date.parse(command.issuedAt)
    const expires = Date.parse(command.expiresAt)
    if (
      expires <= issued ||
      expires - issued > MAX_RELAY_ENVELOPE_LIFETIME_MS ||
      issued > now.getTime() + MAX_RELAY_CLOCK_SKEW_MS ||
      expires <= now.getTime()
    ) {
      throw new Error('RELAY_COMMAND_EXPIRED')
    }
    const canonical = JSON.stringify(command)
    const replay = this.#results.get(command.commandId)
    if (replay !== undefined) {
      if (replay.command !== canonical) throw new Error('RELAY_COMMAND_CONFLICT')
      return { ...replay.result, outcome: 'duplicate' }
    }
    const inFlight = this.#inFlight.get(command.commandId)
    if (inFlight !== undefined) {
      if (inFlight.command !== canonical) throw new Error('RELAY_COMMAND_CONFLICT')
      return { ...(await inFlight.operation), outcome: 'duplicate' }
    }
    const operation = this.#accept(command)
    this.#inFlight.set(command.commandId, { command: canonical, operation })
    try {
      return await operation
    } finally {
      this.#inFlight.delete(command.commandId)
    }
  }

  async #accept(command: RelayMetadataCommand): Promise<RelayMetadataCommandResult<Result>> {
    const accepted = {
      outcome: 'accepted' as const,
      commandId: command.commandId,
      result: await this.accept(command),
    }
    this.#results.set(command.commandId, { command: JSON.stringify(command), result: accepted })
    return accepted
  }
}

export function assertRelayCannotDecrypt(snapshot: string, plaintextCanary: string): void {
  if (snapshot.includes(plaintextCanary)) {
    throw new RelayEnvelopeError('RELAY_ENVELOPE_INVALID')
  }
}

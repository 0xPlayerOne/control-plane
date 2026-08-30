import {
  ExecutionAcceptanceRequestSchema,
  ExecutionAcceptanceResponseSchema,
  type ExecutionAcceptanceResponse,
} from '@control-plane/contracts'
import {
  decryptRelayPayload,
  RelayEnvelopeError,
  sha256,
  type HostEncryptionKeyPair,
} from './crypto.js'
import { EncryptedRelayEnvelopeSchema, type EncryptedRelayEnvelope } from './protocol.js'
import type { RelayCommandResult, RelayHostCommandProcessor } from './relay.js'

export interface ExecutionAcceptancePort {
  accept(envelope: unknown, callerPrincipalId: string): Promise<ExecutionAcceptanceResponse>
}

export type RelayExecutionCommandErrorCode =
  'RELAY_COMMAND_INVALID' | 'RELAY_COMMAND_SCOPE_MISMATCH'

export class RelayExecutionCommandError extends Error {
  constructor(readonly code: RelayExecutionCommandErrorCode) {
    super('Remote execution command was rejected')
    this.name = 'RelayExecutionCommandError'
  }
}

export interface RelayExecutionCommandProcessorOptions {
  readonly hostId: string
  readonly workspaceId: string
  readonly callerPrincipalId: string
  readonly keyResolver: (keyId: string, now: Date) => HostEncryptionKeyPair
  readonly acceptance: ExecutionAcceptancePort
}

/**
 * Bridges decrypted relay commands into the same durable acceptance service used by the Control API.
 * CommandInbox remains the idempotency boundary; this processor never creates a second execution ledger.
 */
export class RelayExecutionCommandProcessor implements RelayHostCommandProcessor<ExecutionAcceptanceResponse> {
  readonly hostId: string
  readonly workspaceId: string
  readonly #callerPrincipalId: string
  readonly #keyResolver: (keyId: string, now: Date) => HostEncryptionKeyPair
  readonly #acceptance: ExecutionAcceptancePort

  constructor(options: RelayExecutionCommandProcessorOptions) {
    this.hostId = options.hostId
    this.workspaceId = options.workspaceId
    this.#callerPrincipalId = options.callerPrincipalId
    this.#keyResolver = options.keyResolver
    this.#acceptance = options.acceptance
  }

  async process(
    envelopeInput: EncryptedRelayEnvelope,
    now: Date = new Date()
  ): Promise<RelayCommandResult<ExecutionAcceptanceResponse>> {
    let envelope: EncryptedRelayEnvelope
    try {
      envelope = EncryptedRelayEnvelopeSchema.parse(envelopeInput)
    } catch {
      throw new RelayEnvelopeError('RELAY_ENVELOPE_INVALID')
    }
    const plaintext = await decryptRelayPayload({
      envelope,
      recipient: this.#keyResolver(envelope.keyId, now),
      expectedHostId: this.hostId,
      expectedWorkspaceId: this.workspaceId,
      now,
    })
    try {
      const payloadDigest = await sha256(plaintext)
      const request = parseExecutionRequest(plaintext)
      if (
        envelope.payloadType !== 'create_execution' ||
        request.workspaceId !== this.workspaceId ||
        request.commandId !== envelope.commandId ||
        request.caller.servicePrincipalId !== this.#callerPrincipalId
      ) {
        throw new RelayExecutionCommandError('RELAY_COMMAND_SCOPE_MISMATCH')
      }
      const result = ExecutionAcceptanceResponseSchema.parse(
        await this.#acceptance.accept(request, this.#callerPrincipalId)
      )
      if (result.data.commandId !== envelope.commandId) {
        throw new RelayExecutionCommandError('RELAY_COMMAND_SCOPE_MISMATCH')
      }
      return {
        outcome: result.data.replayed ? 'duplicate' : 'accepted',
        commandId: envelope.commandId,
        payloadDigest,
        result,
      }
    } finally {
      plaintext.fill(0)
    }
  }
}

function parseExecutionRequest(plaintext: Uint8Array) {
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(plaintext)
    return ExecutionAcceptanceRequestSchema.parse(JSON.parse(decoded))
  } catch (error) {
    if (error instanceof RelayExecutionCommandError) throw error
    throw new RelayExecutionCommandError('RELAY_COMMAND_INVALID')
  }
}

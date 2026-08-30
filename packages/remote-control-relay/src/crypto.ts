import { Aes128Gcm, CipherSuite, HkdfSha256 } from '@hpke/core'
import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519'
import {
  EncryptedRelayEnvelopeSchema,
  MAX_RELAY_CIPHERTEXT_BYTES,
  MAX_RELAY_CLOCK_SKEW_MS,
  MAX_RELAY_ENVELOPE_LIFETIME_MS,
  RELAY_ENVELOPE_VERSION,
  RELAY_HPKE_SUITE,
  RelayEnvelopeHeaderSchema,
  canonicalRelayAssociatedData,
  relayEnvelopeHeader,
  type EncryptedRelayEnvelope,
  type RelayEnvelopeHeader,
  type RelayPayloadType,
} from './protocol.js'

const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes128Gcm(),
})
const HPKE_INFO = new TextEncoder().encode('agent-hq-control-plane-relay-v1')
const AEAD_TAG_BYTES = 16

export type RelayEnvelopeErrorCode =
  | 'RELAY_ENVELOPE_INVALID'
  | 'RELAY_ENVELOPE_TOO_LARGE'
  | 'RELAY_ENVELOPE_EXPIRED'
  | 'RELAY_ENVELOPE_LIFETIME_INVALID'
  | 'RELAY_ENVELOPE_RECIPIENT_MISMATCH'
  | 'RELAY_ENVELOPE_KEY_UNAVAILABLE'
  | 'RELAY_ENVELOPE_DECRYPTION_FAILED'
  | 'RELAY_ENVELOPE_DIGEST_MISMATCH'

export class RelayEnvelopeError extends Error {
  constructor(readonly code: RelayEnvelopeErrorCode) {
    super('Remote control envelope was rejected')
    this.name = 'RelayEnvelopeError'
  }
}

export interface HostEncryptionPublicKey {
  readonly keyId: string
  readonly hostId: string
  readonly publicKey: string
  readonly fingerprint: `sha256:${string}`
  readonly createdAt: string
}

export interface HostEncryptionKeyPair extends HostEncryptionPublicKey {
  readonly privateKey: string
}

export interface RelayReturnKey {
  readonly keyId: string
  readonly publicKey: string
}

export interface EncryptRelayPayloadInput {
  readonly recipient: HostEncryptionPublicKey
  readonly workspaceId: string
  readonly commandId: string
  readonly payloadType: RelayPayloadType
  readonly payloadSchemaVersion: number
  readonly issuedAt: string
  readonly expiresAt: string
  readonly plaintext: Uint8Array
  readonly returnKey?: RelayReturnKey
}

interface EncryptRelayPayloadInternalInput extends EncryptRelayPayloadInput {
  readonly testingEphemeralKeyMaterial?: Uint8Array
}

export interface DecryptRelayPayloadInput {
  readonly envelope: EncryptedRelayEnvelope
  readonly recipient: HostEncryptionKeyPair
  readonly expectedWorkspaceId: string
  readonly expectedHostId: string
  readonly now?: Date
}

export async function generateHostEncryptionKeyPair(
  hostId: string,
  now: Date = new Date()
): Promise<HostEncryptionKeyPair> {
  const pair = await suite.kem.generateKeyPair()
  const publicKey = new Uint8Array(await suite.kem.serializePublicKey(pair.publicKey))
  const privateKey = new Uint8Array(await suite.kem.serializePrivateKey(pair.privateKey))
  const fingerprint = await sha256(publicKey)
  return {
    keyId: `hpk_${fingerprint.slice('sha256:'.length, 'sha256:'.length + 32)}`,
    hostId,
    publicKey: encodeBase64Url(publicKey),
    privateKey: encodeBase64Url(privateKey),
    fingerprint,
    createdAt: now.toISOString(),
  }
}

export async function encryptRelayPayload(
  input: EncryptRelayPayloadInput
): Promise<EncryptedRelayEnvelope> {
  return encryptRelayPayloadInternal(input)
}

export async function encryptRelayPayloadForTesting(
  input: EncryptRelayPayloadInput,
  testingEphemeralKeyMaterial: Uint8Array
): Promise<EncryptedRelayEnvelope> {
  return encryptRelayPayloadInternal({ ...input, testingEphemeralKeyMaterial })
}

async function encryptRelayPayloadInternal(
  input: EncryptRelayPayloadInternalInput
): Promise<EncryptedRelayEnvelope> {
  if (input.plaintext.byteLength + AEAD_TAG_BYTES > MAX_RELAY_CIPHERTEXT_BYTES) {
    throw new RelayEnvelopeError('RELAY_ENVELOPE_TOO_LARGE')
  }
  validateEnvelopeDuration(input.issuedAt, input.expiresAt)
  const header = RelayEnvelopeHeaderSchema.parse({
    envelopeVersion: RELAY_ENVELOPE_VERSION,
    suite: RELAY_HPKE_SUITE,
    keyId: input.recipient.keyId,
    workspaceId: input.workspaceId,
    hostId: input.recipient.hostId,
    commandId: input.commandId,
    payloadType: input.payloadType,
    payloadSchemaVersion: input.payloadSchemaVersion,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    contentDigest: await sha256(input.plaintext),
    ...(input.returnKey === undefined
      ? {}
      : {
          returnKeyId: input.returnKey.keyId,
          returnPublicKey: input.returnKey.publicKey,
        }),
  })
  try {
    const recipientPublicKey = await suite.kem.deserializePublicKey(
      decodeBase64Url(input.recipient.publicKey)
    )
    const ephemeral =
      input.testingEphemeralKeyMaterial === undefined
        ? undefined
        : await suite.kem.deriveKeyPair(input.testingEphemeralKeyMaterial)
    const result = await suite.seal(
      {
        recipientPublicKey,
        info: HPKE_INFO,
        ...(ephemeral === undefined ? {} : { ekm: ephemeral }),
      },
      input.plaintext,
      canonicalRelayAssociatedData(header)
    )
    const ciphertext = new Uint8Array(result.ct)
    if (ciphertext.byteLength > MAX_RELAY_CIPHERTEXT_BYTES) {
      throw new RelayEnvelopeError('RELAY_ENVELOPE_TOO_LARGE')
    }
    return EncryptedRelayEnvelopeSchema.parse({
      ...header,
      encapsulatedKey: encodeBase64Url(new Uint8Array(result.enc)),
      ciphertext: encodeBase64Url(ciphertext),
    })
  } catch (error) {
    if (error instanceof RelayEnvelopeError) throw error
    throw new RelayEnvelopeError('RELAY_ENVELOPE_INVALID')
  }
}

export async function decryptRelayPayload(input: DecryptRelayPayloadInput): Promise<Uint8Array> {
  let envelope: EncryptedRelayEnvelope
  try {
    envelope = EncryptedRelayEnvelopeSchema.parse(input.envelope)
  } catch {
    throw new RelayEnvelopeError('RELAY_ENVELOPE_INVALID')
  }
  if (
    envelope.hostId !== input.expectedHostId ||
    envelope.workspaceId !== input.expectedWorkspaceId ||
    envelope.hostId !== input.recipient.hostId
  ) {
    throw new RelayEnvelopeError('RELAY_ENVELOPE_RECIPIENT_MISMATCH')
  }
  if (envelope.keyId !== input.recipient.keyId) {
    throw new RelayEnvelopeError('RELAY_ENVELOPE_KEY_UNAVAILABLE')
  }
  validateLifetime(envelope.issuedAt, envelope.expiresAt, input.now ?? new Date())
  const ciphertext = decodeBase64Url(envelope.ciphertext)
  if (ciphertext.byteLength > MAX_RELAY_CIPHERTEXT_BYTES) {
    throw new RelayEnvelopeError('RELAY_ENVELOPE_TOO_LARGE')
  }
  let plaintext: Uint8Array
  try {
    const privateKey = await suite.kem.deserializePrivateKey(
      decodeBase64Url(input.recipient.privateKey)
    )
    plaintext = new Uint8Array(
      await suite.open(
        {
          recipientKey: privateKey,
          enc: decodeBase64Url(envelope.encapsulatedKey),
          info: HPKE_INFO,
        },
        ciphertext,
        canonicalRelayAssociatedData(relayEnvelopeHeader(envelope))
      )
    )
  } catch {
    throw new RelayEnvelopeError('RELAY_ENVELOPE_DECRYPTION_FAILED')
  }
  if (!(await equalDigest(envelope.contentDigest, await sha256(plaintext)))) {
    plaintext.fill(0)
    throw new RelayEnvelopeError('RELAY_ENVELOPE_DIGEST_MISMATCH')
  }
  return plaintext
}

export function publicEncryptionKey(key: HostEncryptionKeyPair): HostEncryptionPublicKey {
  return {
    keyId: key.keyId,
    hostId: key.hostId,
    publicKey: key.publicKey,
    fingerprint: key.fingerprint,
    createdAt: key.createdAt,
  }
}

export async function validateHostEncryptionKeyPair(key: HostEncryptionKeyPair): Promise<boolean> {
  try {
    const publicBytes = decodeBase64Url(key.publicKey)
    const fingerprint = await sha256(publicBytes)
    if (
      fingerprint !== key.fingerprint ||
      key.keyId !== `hpk_${fingerprint.slice('sha256:'.length, 'sha256:'.length + 32)}`
    ) {
      return false
    }
    const recipientPublicKey = await suite.kem.deserializePublicKey(publicBytes)
    const recipientKey = await suite.kem.deserializePrivateKey(decodeBase64Url(key.privateKey))
    const probe = new TextEncoder().encode('host-key-pair-validation')
    const sealed = await suite.seal({ recipientPublicKey, info: HPKE_INFO }, probe)
    const opened = new Uint8Array(
      await suite.open({ recipientKey, enc: sealed.enc, info: HPKE_INFO }, sealed.ct)
    )
    return (
      opened.byteLength === probe.byteLength &&
      opened.every((byte, index) => byte === probe.at(index))
    )
  } catch {
    return false
  }
}

export async function sha256(value: Uint8Array): Promise<`sha256:${string}`> {
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(value).buffer)
  )
  return `sha256:${hex(digest)}`
}

export function encodeBase64Url(value: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < value.length; offset += 0x8000) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000))
  }
  return globalThis.btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

export function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) {
    throw new RelayEnvelopeError('RELAY_ENVELOPE_INVALID')
  }
  const padded = `${value.replaceAll('-', '+').replaceAll('_', '/')}${'='.repeat((4 - (value.length % 4)) % 4)}`
  let binary: string
  try {
    binary = globalThis.atob(padded)
  } catch {
    throw new RelayEnvelopeError('RELAY_ENVELOPE_INVALID')
  }
  const decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  if (encodeBase64Url(decoded) !== value) {
    throw new RelayEnvelopeError('RELAY_ENVELOPE_INVALID')
  }
  return decoded
}

function validateLifetime(issuedAt: string, expiresAt: string, now: Date): void {
  const { issued, expires } = validateEnvelopeDuration(issuedAt, expiresAt)
  const observed = now.getTime()
  if (issued > observed + MAX_RELAY_CLOCK_SKEW_MS || expires <= observed) {
    throw new RelayEnvelopeError('RELAY_ENVELOPE_EXPIRED')
  }
}

function validateEnvelopeDuration(
  issuedAt: string,
  expiresAt: string
): { issued: number; expires: number } {
  const issued = Date.parse(issuedAt)
  const expires = Date.parse(expiresAt)
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued) {
    throw new RelayEnvelopeError('RELAY_ENVELOPE_LIFETIME_INVALID')
  }
  if (expires - issued > MAX_RELAY_ENVELOPE_LIFETIME_MS) {
    throw new RelayEnvelopeError('RELAY_ENVELOPE_LIFETIME_INVALID')
  }
  return { issued, expires }
}

async function equalDigest(left: string, right: string): Promise<boolean> {
  const leftBytes = new TextEncoder().encode(left)
  const rightBytes = new TextEncoder().encode(right)
  if (leftBytes.byteLength !== rightBytes.byteLength) return false
  let difference = 0
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= (leftBytes.at(index) ?? 0) ^ (rightBytes.at(index) ?? 0)
  }
  return difference === 0
}

function hex(value: Uint8Array): string {
  return [...value].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export type { RelayEnvelopeHeader }

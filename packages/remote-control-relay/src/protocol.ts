import { z } from 'zod'

export const RELAY_ENVELOPE_VERSION = 1 as const
export const RELAY_HPKE_SUITE = 'DHKEM_X25519_HKDF_SHA256_HKDF_SHA256_AES_128_GCM' as const
export const MAX_RELAY_CIPHERTEXT_BYTES = 1024 * 1024
export const MAX_RELAY_ENVELOPE_LIFETIME_MS = 24 * 60 * 60 * 1000
export const MAX_RELAY_CLOCK_SKEW_MS = 5 * 60 * 1000

const IdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/)
const KeyIdSchema = z
  .string()
  .min(8)
  .max(96)
  .regex(/^(?:hpk|rpk)_[a-f0-9]+$/)
const Base64UrlSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/)
const X25519PublicKeySchema = Base64UrlSchema.length(43)
const CiphertextSchema = Base64UrlSchema.max(Math.ceil((MAX_RELAY_CIPHERTEXT_BYTES * 4) / 3))

export const RelayPayloadTypeSchema = z.enum([
  'create_execution',
  'submit_input',
  'execution_result',
  'interaction_result',
])

export const RelayEnvelopeHeaderSchema = z
  .object({
    envelopeVersion: z.literal(RELAY_ENVELOPE_VERSION),
    suite: z.literal(RELAY_HPKE_SUITE),
    keyId: KeyIdSchema,
    workspaceId: IdentifierSchema,
    hostId: IdentifierSchema,
    commandId: IdentifierSchema,
    payloadType: RelayPayloadTypeSchema,
    payloadSchemaVersion: z.number().int().min(1).max(65_535),
    issuedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    contentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    returnKeyId: KeyIdSchema.optional(),
    returnPublicKey: X25519PublicKeySchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.returnKeyId === undefined) !== (value.returnPublicKey === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'return key id and public key must be supplied together',
      })
    }
  })

export const EncryptedRelayEnvelopeSchema = RelayEnvelopeHeaderSchema.extend({
  encapsulatedKey: X25519PublicKeySchema,
  ciphertext: CiphertextSchema,
}).strict()

export type RelayPayloadType = z.infer<typeof RelayPayloadTypeSchema>
export type RelayEnvelopeHeader = z.infer<typeof RelayEnvelopeHeaderSchema>
export type EncryptedRelayEnvelope = z.infer<typeof EncryptedRelayEnvelopeSchema>

export const RelayMetadataCommandSchema = z
  .object({
    schemaVersion: z.literal(1),
    workspaceId: IdentifierSchema,
    hostId: IdentifierSchema,
    commandId: IdentifierSchema,
    operation: z.enum(['cancel', 'resume', 'approve', 'deny', 'status']),
    issuedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    targetId: IdentifierSchema,
  })
  .strict()

export type RelayMetadataCommand = z.infer<typeof RelayMetadataCommandSchema>

export const RelayStatusProjectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    workspaceId: IdentifierSchema,
    hostId: IdentifierSchema,
    commandId: IdentifierSchema,
    state: z.enum([
      'received',
      'accepted',
      'running',
      'waiting',
      'completed',
      'cancelled',
      'failed',
      'rejected',
      'unknown',
    ]),
    reasonCode: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Z0-9_]+$/)
      .optional(),
    occurredAt: z.iso.datetime(),
  })
  .strict()

export type RelayStatusProjection = z.infer<typeof RelayStatusProjectionSchema>

export function relayEnvelopeHeader(envelope: EncryptedRelayEnvelope): RelayEnvelopeHeader {
  return RelayEnvelopeHeaderSchema.parse({
    envelopeVersion: envelope.envelopeVersion,
    suite: envelope.suite,
    keyId: envelope.keyId,
    workspaceId: envelope.workspaceId,
    hostId: envelope.hostId,
    commandId: envelope.commandId,
    payloadType: envelope.payloadType,
    payloadSchemaVersion: envelope.payloadSchemaVersion,
    issuedAt: envelope.issuedAt,
    expiresAt: envelope.expiresAt,
    contentDigest: envelope.contentDigest,
    ...(envelope.returnKeyId === undefined ? {} : { returnKeyId: envelope.returnKeyId }),
    ...(envelope.returnPublicKey === undefined
      ? {}
      : { returnPublicKey: envelope.returnPublicKey }),
  })
}

export function canonicalRelayAssociatedData(header: RelayEnvelopeHeader): Uint8Array {
  const value = RelayEnvelopeHeaderSchema.parse(header)
  return new TextEncoder().encode(
    JSON.stringify({
      envelopeVersion: value.envelopeVersion,
      suite: value.suite,
      keyId: value.keyId,
      workspaceId: value.workspaceId,
      hostId: value.hostId,
      commandId: value.commandId,
      payloadType: value.payloadType,
      payloadSchemaVersion: value.payloadSchemaVersion,
      issuedAt: value.issuedAt,
      expiresAt: value.expiresAt,
      contentDigest: value.contentDigest,
      ...(value.returnKeyId === undefined ? {} : { returnKeyId: value.returnKeyId }),
      ...(value.returnPublicKey === undefined ? {} : { returnPublicKey: value.returnPublicKey }),
    })
  )
}

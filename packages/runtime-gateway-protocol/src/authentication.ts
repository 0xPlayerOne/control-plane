import { z } from 'zod'

const TimestampSchema = z.iso.datetime()
const compactPart = z
  .string()
  .min(2)
  .max(4096)
  .regex(/^[A-Za-z0-9_-]+$/)
export const RuntimeNodeIdSchema = z.string().regex(/^rnr_[0-9A-HJKMNP-TV-Z]{26}$/)
export const RuntimeNodeWorkspaceIdSchema = z.string().regex(/^wsp_[0-9A-HJKMNP-TV-Z]{26}$/)

export const RuntimeNodeCredentialClaimsSchema = z
  .object({
    schemaVersion: z.literal(1),
    credentialKind: z.literal('runtime_node'),
    credentialId: z
      .string()
      .min(8)
      .max(128)
      .regex(/^rgc_[A-Za-z0-9_-]+$/),
    issuer: z.url().max(512),
    audience: z.string().min(3).max(256),
    nodeId: RuntimeNodeIdSchema,
    workspaceId: RuntimeNodeWorkspaceIdSchema,
    keyId: z
      .string()
      .min(4)
      .max(128)
      .regex(/^rgk_[A-Za-z0-9_-]+$/),
    proofKeyThumbprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    revocationVersion: z.number().int().positive(),
    channelGeneration: z.number().int().positive(),
    issuedAt: TimestampSchema,
    expiresAt: TimestampSchema,
  })
  .strict()
  .refine((claims) => Date.parse(claims.expiresAt) > Date.parse(claims.issuedAt), {
    message: 'Credential expiry must follow issuance',
    path: ['expiresAt'],
  })

export type RuntimeNodeCredentialClaims = z.output<typeof RuntimeNodeCredentialClaimsSchema>

export const RuntimeNodeAuthenticationAttemptSchema = z
  .object({
    credential: z
      .string()
      .min(32)
      .max(16_384)
      .refine((value) => value.split('.').length === 3),
    proof: z
      .object({
        challenge: z
          .string()
          .min(16)
          .max(256)
          .regex(/^[A-Za-z0-9._:-]+$/),
        signature: compactPart,
      })
      .strict(),
  })
  .strict()

export type RuntimeNodeAuthenticationAttempt = z.output<
  typeof RuntimeNodeAuthenticationAttemptSchema
>

export class RuntimeNodeIdentityValidationError extends Error {
  constructor(readonly reason: 'credential' | 'proof') {
    super('RuntimeNode identity validation failed')
    this.name = 'RuntimeNodeIdentityValidationError'
  }
}

export interface RuntimeNodeIdentityValidationPort {
  verify(attempt: RuntimeNodeAuthenticationAttempt): Promise<unknown>
  isRevoked(credentialId: string, revocationVersion: number): Promise<boolean>
  subscribeRevocations(listener: (credentialId: string) => void): () => void
}

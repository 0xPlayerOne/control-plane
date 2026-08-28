import { z } from 'zod'
import { IdentifierSchemas } from './identifiers.js'

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const ProviderIdSchema = z.string().regex(/^ctp_[0-9A-HJKMNP-TV-Z]{26}$/)
const ConnectionIdSchema = z.string().regex(/^ctc_[0-9A-HJKMNP-TV-Z]{26}$/)
const TimestampSchema = z.iso.datetime()

export const MemoryWritePolicySchema = z.object({
  mode: z.enum(['disabled', 'proposal_only', 'approval_required']).default('disabled'),
  maximumBytes: z.number().int().positive().max(65_536),
  allowedSensitivities: z.array(z.enum(['public', 'internal', 'confidential', 'restricted'])),
  approvalPrincipalIds: z.array(z.string().min(3).max(128)).max(64),
})

export const MemoryWriteProposalSchema = z
  .object({
    proposalId: IdentifierSchemas.memoryWriteProposalId,
    providerId: ProviderIdSchema,
    connectionId: ConnectionIdSchema,
    workspaceId: IdentifierSchemas.workspaceId,
    scopeDigest: DigestSchema,
    memoryType: z.enum(['fact', 'preference', 'observation', 'summary']),
    content: z.string().min(1).max(65_536),
    retention: z.enum(['session', 'project', 'durable']),
    provenance: z.object({
      sourceExecutionId: IdentifierSchemas.executionId,
      sourceAttemptId: IdentifierSchemas.attemptId,
      confidence: z.number().min(0).max(1),
      importance: z.number().min(0).max(1),
      sensitivity: z.enum(['public', 'internal', 'confidential', 'restricted']),
      expiresAt: TimestampSchema.optional(),
      evidenceRefs: z.array(z.string().min(1).max(1_024)).max(64),
      artifactRefs: z.array(IdentifierSchemas.artifactId).max(64),
    }),
    dedupeHint: z.string().min(1).max(256),
    contentDigest: DigestSchema,
    state: z.enum([
      'proposed',
      'awaiting_approval',
      'approved',
      'denied',
      'expired',
      'revoked',
      'committing',
      'committed',
      'failed',
      'reconciliation_required',
    ]),
    version: z.number().int().positive(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    approvalInteractionId: IdentifierSchemas.interactionId.optional(),
    outcome: z
      .object({
        code: z.enum([
          'approved',
          'denied',
          'expired',
          'revoked',
          'failed',
          'committed',
          'reconciled',
          'ambiguous',
        ]),
        observedAt: TimestampSchema,
        providerMemoryRef: z.string().min(1).max(512).optional(),
      })
      .optional(),
  })
  .superRefine((proposal, context) => {
    if (Buffer.byteLength(proposal.content, 'utf8') > 65_536)
      context.addIssue({ code: 'custom', path: ['content'], message: 'Content exceeds byte limit' })
    if (proposal.approvalInteractionId && proposal.state === 'proposed')
      context.addIssue({ code: 'custom', message: 'Proposed state cannot have approval effect' })
  })

export type MemoryWritePolicy = z.output<typeof MemoryWritePolicySchema>
export type MemoryWriteProposal = z.output<typeof MemoryWriteProposalSchema>

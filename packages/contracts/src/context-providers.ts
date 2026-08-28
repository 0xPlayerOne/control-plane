import { z } from 'zod'
import { IdentifierSchemas } from './identifiers.js'

const TimestampSchema = z.iso.datetime()
const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const SemverSchema = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
const ProviderIdSchema = z.string().regex(/^ctp_[0-9A-HJKMNP-TV-Z]{26}$/)
const ConnectionIdSchema = z.string().regex(/^ctc_[0-9A-HJKMNP-TV-Z]{26}$/)

export const ContextProviderCapabilitiesSchema = z.object({
  boundedRetrieval: z.boolean(),
  evidenceSearch: z.boolean(),
  memoryRecall: z.boolean(),
  healthStatus: z.boolean(),
  memoryWriteProposal: z.boolean(),
  memoryWriteCommit: z.boolean(),
})

export const ContextProviderDefinitionSchema = z.object({
  providerId: ProviderIdSchema,
  providerType: z.string().min(1).max(128),
  displayName: z.string().min(1).max(256),
  contractVersion: SemverSchema,
  latencyClass: z.enum(['low', 'standard', 'high']).default('standard'),
  costClass: z.enum(['low', 'standard', 'premium']).default('standard'),
  capabilities: ContextProviderCapabilitiesSchema,
})

export const ContextProviderConnectionSchema = z.object({
  connectionId: ConnectionIdSchema,
  providerId: ProviderIdSchema,
  workspaceId: IdentifierSchemas.workspaceId,
  principalRef: z.string().min(1).max(256),
  scopeDigest: DigestSchema,
  executionLocations: z.array(z.enum(['cloud', 'runtime_node'])).min(1),
  reachability: z.enum(['direct', 'remote']).default('remote'),
  state: z.enum(['active', 'revoked']),
})

export const ContextProviderPolicySchema = z.object({
  mode: z.enum(['disabled', 'preferred', 'required']),
  providerIds: z.array(ProviderIdSchema),
  connectionIds: z.array(ConnectionIdSchema).default([]),
  includeEvidence: z.boolean(),
  includeMemory: z.boolean(),
  maximumTokens: z.number().int().nonnegative(),
  maximumAgeSeconds: z.number().int().nonnegative(),
  maximumProviderHealthAgeSeconds: z.number().int().nonnegative().default(60),
  maximumLatencyMs: z.number().int().positive(),
  failureBehavior: z.enum(['continue_without', 'fail', 'await_input']).default('continue_without'),
})

export const ContextContributionSchema = z.object({
  providerId: ProviderIdSchema,
  connectionId: ConnectionIdSchema,
  contractVersion: SemverSchema,
  contributionId: z.string().min(1).max(256),
  kind: z.enum(['context', 'evidence', 'memory']),
  content: z.string().max(262_144),
  tokenCount: z.number().int().nonnegative(),
  observedAt: TimestampSchema,
  expiresAt: TimestampSchema.optional(),
  scopeDigest: DigestSchema,
  revision: z.string().min(1).max(256),
  contentDigest: DigestSchema,
  degraded: z.boolean(),
  provenance: z.array(
    z.object({
      sourceRef: z.string().min(1).max(1_024),
      citation: z.string().min(1).max(2_048).optional(),
      sourceKind: z.enum(['external_evidence', 'provider_memory', 'provider_context']),
    })
  ),
  providerMetadata: z
    .object({
      bundleId: z.string().min(1).max(256),
      bundleDigest: DigestSchema,
      corpusRevision: z.string().min(1).max(256),
      memoryRevision: z.string().min(1).max(256).optional(),
      embeddingVersion: z.string().min(1).max(128).optional(),
      retrievalVersion: z.string().min(1).max(128),
      omittedCount: z.number().int().nonnegative(),
    })
    .optional(),
})

export const ContextProviderReadModelSchema = z.object({
  definition: ContextProviderDefinitionSchema,
  connection: ContextProviderConnectionSchema,
  health: z.object({
    status: z.enum(['healthy', 'degraded', 'unavailable']),
    checkedAt: TimestampSchema,
    reasonCode: z.string().min(1).max(128).optional(),
  }),
})

export type ContextProviderCapabilities = z.output<typeof ContextProviderCapabilitiesSchema>
export type ContextProviderDefinition = z.output<typeof ContextProviderDefinitionSchema>
export type ContextProviderConnection = z.output<typeof ContextProviderConnectionSchema>
export type ContextProviderPolicy = z.output<typeof ContextProviderPolicySchema>
export type ContextContribution = z.output<typeof ContextContributionSchema>
export type ContextProviderReadModel = z.output<typeof ContextProviderReadModelSchema>

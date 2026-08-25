import { IdentifierSchemas } from '@control-plane/contracts'
import { z } from 'zod'

const TimestampSchema = z.iso.datetime()
const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const SemanticVersionSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/)
const CanonicalNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9.-]*$/)
const JsonObjectSchema = z.record(z.string(), z.json())
const unique = <Value>(values: Value[]) => new Set(values).size === values.length

export const ToolOwnershipSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('system') }).strict(),
  z.object({ scope: z.literal('workspace'), workspaceId: IdentifierSchemas.workspaceId }).strict(),
])

export const ToolDefinitionSchema = z
  .object({
    toolDefinitionId: IdentifierSchemas.toolDefinitionId,
    name: CanonicalNameSchema,
    displayName: z.string().min(1).max(128),
    description: z.string().min(1).max(2_048),
    ownership: ToolOwnershipSchema,
    createdAt: TimestampSchema,
  })
  .strict()

export const ToolExecutorTypeSchema = z.enum(['internal', 'connector', 'mcp', 'sandbox'])
export const ToolVersionLifecycleSchema = z.enum([
  'published',
  'deprecated',
  'revoked',
  'superseded',
])
export const ToolRiskClassSchema = z.enum(['low', 'medium', 'high', 'critical'])
export const ToolApprovalModeSchema = z.enum(['never', 'policy', 'always'])
export const ToolIdempotencySchema = z.enum(['inherent', 'provider_key', 'reconcile', 'none'])

export const ToolOperationSchema = z
  .object({
    name: CanonicalNameSchema,
    requiredCapabilities: z.array(CanonicalNameSchema).max(64).refine(unique),
    riskClass: ToolRiskClassSchema,
    approvalMode: ToolApprovalModeSchema,
    idempotency: ToolIdempotencySchema,
  })
  .strict()

export const ToolExecutorReferenceSchema = z
  .object({
    type: ToolExecutorTypeSchema,
    reference: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/),
  })
  .strict()

export const ToolLimitsSchema = z
  .object({
    maxInputBytes: z.number().int().positive().max(1_048_576),
    maxOutputBytes: z.number().int().positive().max(16_777_216),
    timeoutMs: z.number().int().positive().max(900_000),
  })
  .strict()

const ToolVersionFieldsSchema = z
  .object({
    toolVersionId: IdentifierSchemas.toolVersionId,
    toolDefinitionId: IdentifierSchemas.toolDefinitionId,
    semanticVersion: SemanticVersionSchema,
    inputSchema: JsonObjectSchema,
    outputSchema: JsonObjectSchema,
    operations: z
      .array(ToolOperationSchema)
      .min(1)
      .max(64)
      .refine((operations) => unique(operations.map(({ name }) => name))),
    executor: ToolExecutorReferenceSchema,
    limits: ToolLimitsSchema,
    createdAt: TimestampSchema,
    publishedAt: TimestampSchema,
  })
  .strict()

export const ToolVersionDraftSchema = ToolVersionFieldsSchema
export const ToolVersionSchema = ToolVersionFieldsSchema.extend({
  revision: z.number().int().positive(),
  lifecycle: ToolVersionLifecycleSchema,
  contentDigest: DigestSchema,
}).strict()

export const ToolGrantSchema = z
  .object({
    workspaceId: IdentifierSchemas.workspaceId,
    profileId: IdentifierSchemas.profileId,
    toolDefinitionId: IdentifierSchemas.toolDefinitionId,
    toolVersionId: IdentifierSchemas.toolVersionId,
    operations: z.array(CanonicalNameSchema).min(1).max(64).refine(unique),
    expiresAt: TimestampSchema.optional(),
  })
  .strict()

export const ToolExecutionRequestSchema = z
  .object({
    requestId: IdentifierSchemas.requestId,
    executionId: IdentifierSchemas.executionId,
    attemptId: IdentifierSchemas.attemptId,
    workspaceId: IdentifierSchemas.workspaceId,
    profileId: IdentifierSchemas.profileId,
    toolDefinitionId: IdentifierSchemas.toolDefinitionId,
    toolVersionId: IdentifierSchemas.toolVersionId,
    operation: CanonicalNameSchema,
    input: z.json(),
    grant: ToolGrantSchema,
    audit: z
      .object({
        principalRef: z.string().min(1).max(256),
        traceId: IdentifierSchemas.traceId,
      })
      .strict(),
  })
  .strict()

export const ToolExecutionResultSchema = z
  .object({
    toolDefinitionId: IdentifierSchemas.toolDefinitionId,
    toolVersionId: IdentifierSchemas.toolVersionId,
    operation: CanonicalNameSchema,
    output: z.json(),
    artifactRefs: z.array(IdentifierSchemas.artifactId).max(128),
    executor: ToolExecutorReferenceSchema,
    audit: z
      .object({
        principalRef: z.string().min(1).max(256),
        traceId: IdentifierSchemas.traceId,
        contentDigest: DigestSchema,
      })
      .strict(),
  })
  .strict()

export type ToolDefinition = z.output<typeof ToolDefinitionSchema>
export type ToolVersion = z.output<typeof ToolVersionSchema>
export type ToolVersionDraft = z.input<typeof ToolVersionDraftSchema>
export type ToolGrant = z.output<typeof ToolGrantSchema>
export type ToolExecutionRequest = z.output<typeof ToolExecutionRequestSchema>
export type ToolExecutionResult = z.output<typeof ToolExecutionResultSchema>
export type ToolExecutorType = z.output<typeof ToolExecutorTypeSchema>

export interface ToolExecutor {
  execute(
    request: ToolExecutionRequest,
    version: ToolVersion
  ): Promise<{ readonly output: unknown; readonly artifactRefs?: readonly string[] }>
}

export const packageName = 'tool-sdk'

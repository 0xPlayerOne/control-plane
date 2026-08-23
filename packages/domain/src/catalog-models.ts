import { z } from 'zod'
import { IdentifierSchemas } from '@control-plane/contracts'

const TimestampSchema = z.iso.datetime()
const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const CapabilitySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9.-]*$/)
const ToolIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9.-]*$/)
const unique = <Value>(values: Value[]) => new Set(values).size === values.length

export const CatalogOwnershipSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('system') }),
  z.object({ scope: z.literal('workspace'), workspaceId: IdentifierSchemas.workspaceId }),
  z.object({ scope: z.literal('organization'), organizationRef: z.string().min(1).max(128) }),
  z.object({ scope: z.literal('private'), principalRef: z.string().min(1).max(128) }),
])

export const VersionLifecycleSchema = z.enum([
  'draft',
  'published',
  'deprecated',
  'revoked',
  'superseded',
])

export const ExactSkillVersionReferenceSchema = z.object({
  skillId: IdentifierSchemas.skillId,
  skillVersionId: IdentifierSchemas.skillVersionId,
  contentDigest: DigestSchema,
})

const VersionedPolicyReferenceSchema = z.object({
  policyId: z.string().min(1).max(128),
  version: z.number().int().positive(),
})

const ToolRequirementSchema = z.object({
  toolId: ToolIdSchema,
  versionRange: z.string().min(1).max(64),
})

export const AgentProfileDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  roleInstructions: z.string().min(1).max(32_768),
  personaInstructions: z.string().max(32_768).optional(),
  skills: z.array(ExactSkillVersionReferenceSchema).max(128),
  capabilityRequirements: z.array(CapabilitySchema).max(128).refine(unique),
  modelPolicyRef: VersionedPolicyReferenceSchema,
  toolRequirements: z.array(ToolRequirementSchema).max(128),
  contextPolicyRef: VersionedPolicyReferenceSchema,
  runtimeConstraints: z.object({
    allowedRuntimeClasses: z.array(z.string().min(1).max(128)).min(1).max(32).refine(unique),
    localProjectRequired: z.boolean(),
  }),
  interactionPolicy: z.object({
    allowedModes: z.array(z.enum(['autonomous', 'interactive', 'approval_required'])).min(1),
    approvalRequiredForSideEffects: z.boolean(),
  }),
  outputContractRefs: z.array(z.string().min(1).max(256)).max(32).refine(unique),
})

export const SkillContentSchema = z.object({
  instructions: z.string().min(1).max(65_536),
  artifactRefs: z.array(z.string().min(1).max(512)).max(128).refine(unique),
})

export const SkillManifestSchema = z.object({
  schemaVersion: z.literal(1),
  semanticVersion: z
    .string()
    .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/),
  contentDigest: DigestSchema,
  requiredCapabilities: z.array(CapabilitySchema).max(128).refine(unique),
  requiredTools: z.array(ToolRequirementSchema).max(128),
  compatibleProfileSchemaVersions: z.array(z.number().int().positive()).min(1).refine(unique),
  compatibleContractMajorVersions: z.array(z.number().int().positive()).min(1).refine(unique),
  evalRefs: z.array(z.string().min(1).max(512)).max(32).refine(unique).optional(),
})

export const AgentProfileSchema = z.object({
  profileId: IdentifierSchemas.profileId,
  displayName: z.string().min(1).max(128),
  ownership: CatalogOwnershipSchema,
  createdAt: TimestampSchema,
})

export const SkillSchema = z.object({
  skillId: IdentifierSchemas.skillId,
  displayName: z.string().min(1).max(128),
  ownership: CatalogOwnershipSchema,
  createdAt: TimestampSchema,
})

const LifecycleMetadataSchema = z.object({
  publishedAt: TimestampSchema.optional(),
  deprecatedAt: TimestampSchema.optional(),
  revokedAt: TimestampSchema.optional(),
  supersededAt: TimestampSchema.optional(),
  supersededByVersionId: IdentifierSchemas.profileVersionId.optional(),
  reason: z.string().min(1).max(512).optional(),
})

export const AgentProfileVersionSchema = z.object({
  profileVersionId: IdentifierSchemas.profileVersionId,
  profileId: IdentifierSchemas.profileId,
  version: z.number().int().positive(),
  revision: z.number().int().positive(),
  lifecycle: VersionLifecycleSchema,
  contentDigest: DigestSchema,
  definition: AgentProfileDefinitionSchema,
  createdAt: TimestampSchema,
  lifecycleMetadata: LifecycleMetadataSchema,
})

export const SkillVersionSchema = z.object({
  skillVersionId: IdentifierSchemas.skillVersionId,
  skillId: IdentifierSchemas.skillId,
  revision: z.number().int().positive(),
  lifecycle: VersionLifecycleSchema,
  manifest: SkillManifestSchema,
  content: SkillContentSchema,
  createdAt: TimestampSchema,
  lifecycleMetadata: LifecycleMetadataSchema.omit({
    supersededByVersionId: true,
  }).extend({ supersededByVersionId: IdentifierSchemas.skillVersionId.optional() }),
})

export const AgentProfilePinSchema = z.object({
  profileId: IdentifierSchemas.profileId,
  profileVersionId: IdentifierSchemas.profileVersionId,
})

export type AgentProfile = z.output<typeof AgentProfileSchema>
export type AgentProfileDefinition = z.output<typeof AgentProfileDefinitionSchema>
export type AgentProfilePin = z.output<typeof AgentProfilePinSchema>
export type AgentProfileVersion = z.output<typeof AgentProfileVersionSchema>
export type Skill = z.output<typeof SkillSchema>
export type SkillContent = z.output<typeof SkillContentSchema>
export type SkillManifest = z.output<typeof SkillManifestSchema>
export type SkillVersion = z.output<typeof SkillVersionSchema>

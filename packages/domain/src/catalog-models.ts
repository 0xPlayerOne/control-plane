import { z } from 'zod'
import { IdentifierSchemas } from '@control-plane/contracts'
import { ExecutionConstraintSetSchema } from './execution-constraints.js'

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

const VersionRangeSchema = z.string().min(1).max(128)
const SkillRelationSchema = z.object({
  skillId: IdentifierSchemas.skillId,
  versionRange: VersionRangeSchema,
})

export const SkillDependencySchema = SkillRelationSchema
export const SkillConflictSchema = SkillRelationSchema

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

const ToolRequirementSchema = z.object({
  toolId: ToolIdSchema,
  versionRange: z.string().min(1).max(64),
})

export const AgentProfileDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  roleInstructions: z.string().min(1).max(32_768),
  personaInstructions: z.string().max(32_768).optional(),
  hardInstructions: z.array(z.string().min(1).max(8_192)).max(128).default([]),
  defaultInstructions: z.array(z.string().min(1).max(8_192)).max(128).default([]),
  purpose: z.string().min(1).max(512).optional(),
  tags: z.array(z.string().min(1).max(64)).max(64).refine(unique).default([]),
  skills: z.array(ExactSkillVersionReferenceSchema).max(128),
  capabilityRequirements: z.array(CapabilitySchema).max(128).refine(unique),
  executionConstraints: ExecutionConstraintSetSchema,
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
  dependencies: z.array(SkillDependencySchema).max(128).default([]),
  conflicts: z.array(SkillConflictSchema).max(128).default([]),
  supersedes: z.array(SkillConflictSchema).max(128).default([]),
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
  provenance: z
    .object({
      source: z.enum(['system-curated', 'workspace-authorized', 'private-user-authorized']),
      ownerRef: z.string().min(1).max(256),
      trust: z.enum(['trusted', 'authorized']).default('authorized'),
    })
    .default({ source: 'private-user-authorized', ownerRef: 'unknown', trust: 'authorized' }),
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

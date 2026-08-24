import { z } from 'zod'
import { ContractVersionSchema, IdentifierSchemas } from '@control-plane/contracts'
import {
  RuntimeCapabilitySchema,
  evaluateCapabilities,
  type CapabilityRequirement,
  type RuntimeCapability,
} from './capabilities.js'

export const RuntimeTimestampSchema = z.iso.datetime()
export const RuntimeSemanticVersionSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
const RuntimeFamilySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/)
const uniqueCapabilities = (capabilities: RuntimeCapability[]) =>
  new Set(capabilities.map((capability) => capability.name)).size === capabilities.length

export const RuntimeLocationSchema = z.enum(['local_device', 'remote_host', 'managed_sandbox'])
export const RuntimeHealthSchema = z.enum(['healthy', 'degraded', 'unavailable'])
export const RuntimeLifecycleSchema = z.enum(['active', 'deprecated', 'revoked'])

export const RuntimeCompatibilityMetadataSchema = z.object({
  status: z.enum(['tested', 'untested', 'incompatible']),
  testedVersions: z.object({
    contractVersion: ContractVersionSchema,
    adapterVersion: RuntimeSemanticVersionSchema,
    driverVersion: RuntimeSemanticVersionSchema,
    harnessVersion: RuntimeSemanticVersionSchema,
  }),
  limitations: z.array(z.string().min(1).max(512)).max(64),
  reason: z.string().min(1).max(512).optional(),
})

export const RuntimeDefinitionSchema = z.object({
  runtimeDefinitionId: IdentifierSchemas.runtimeDefinitionId,
  family: RuntimeFamilySchema,
  adapterVersion: RuntimeSemanticVersionSchema,
  driverVersion: RuntimeSemanticVersionSchema,
  harnessVersion: RuntimeSemanticVersionSchema,
  location: RuntimeLocationSchema,
  health: RuntimeHealthSchema,
  lifecycle: RuntimeLifecycleSchema,
  capabilities: z.array(RuntimeCapabilitySchema).max(64).refine(uniqueCapabilities),
  compatibility: RuntimeCompatibilityMetadataSchema,
})

export type RuntimeDefinition = z.output<typeof RuntimeDefinitionSchema>

export const RuntimeNodeRefSchema = z.object({
  runtimeNodeRefId: IdentifierSchemas.runtimeNodeRefId,
  authority: z.literal('agent_hq'),
  displayName: z.string().min(1).max(128),
  location: RuntimeLocationSchema,
  status: z.enum(['online', 'offline', 'revoked']),
  observedAt: RuntimeTimestampSchema,
})

export const RuntimeConnectionTypeSchema = z.enum([
  'managed_cloud',
  'managed_local',
  'external_local',
])
export const RuntimeConnectionStatusSchema = z.enum([
  'connected',
  'degraded',
  'unavailable',
  'disconnected',
  'expired',
  'revoked',
])
export const RuntimeCompatibilityStateSchema = z.enum([
  'compatible',
  'degraded',
  'untested',
  'incompatible',
  'deprecated',
  'revoked',
  'unavailable',
  'capability_missing',
])
export const RuntimeConnectionIdentityDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)
export const RuntimeOpaqueNativeRefSchema = z
  .string()
  .min(6)
  .max(133)
  .regex(/^nref_[A-Za-z0-9_-]+$/)

export const RuntimeConnectionSchema = z
  .object({
    runtimeConnectionId: IdentifierSchemas.runtimeConnectionId,
    identityDigest: RuntimeConnectionIdentityDigestSchema,
    connectionType: RuntimeConnectionTypeSchema,
    runtimeNodeRefId: IdentifierSchemas.runtimeNodeRefId.optional(),
    runtimeDefinitionId: IdentifierSchemas.runtimeDefinitionId,
    location: RuntimeLocationSchema,
    opaqueNativeRef: RuntimeOpaqueNativeRefSchema.optional(),
    adapterVersion: RuntimeSemanticVersionSchema,
    driverVersion: RuntimeSemanticVersionSchema,
    harnessVersion: RuntimeSemanticVersionSchema,
    status: RuntimeConnectionStatusSchema,
    health: RuntimeHealthSchema,
    capabilities: z.array(RuntimeCapabilitySchema).max(64).refine(uniqueCapabilities),
    compatibilityState: RuntimeCompatibilityStateSchema,
    limitations: z.array(z.string().min(1).max(512)).max(64),
    lastDiscoveredAt: RuntimeTimestampSchema,
    lastHeartbeatAt: RuntimeTimestampSchema,
    lastHealthCheckAt: RuntimeTimestampSchema,
    expiresAt: RuntimeTimestampSchema.optional(),
    version: z.number().int().positive(),
    createdAt: RuntimeTimestampSchema,
    updatedAt: RuntimeTimestampSchema,
  })
  .strict()
  .superRefine((connection, context) => {
    const local = connection.connectionType !== 'managed_cloud'
    if (local !== (connection.runtimeNodeRefId !== undefined)) {
      context.addIssue({ code: 'custom', message: 'Only local connections require a RuntimeNode' })
    }
    const expectedLocation = local ? 'local_device' : 'managed_sandbox'
    if (connection.location !== expectedLocation) {
      context.addIssue({ code: 'custom', message: 'Connection type and location must agree' })
    }
    const unavailable = ['unavailable', 'disconnected', 'expired', 'revoked'].includes(
      connection.status
    )
    if (unavailable !== (connection.health === 'unavailable')) {
      context.addIssue({ code: 'custom', message: 'Connection status and health must agree' })
    }
    if (connection.status === 'revoked' && connection.compatibilityState !== 'revoked') {
      context.addIssue({
        code: 'custom',
        message: 'Revoked connections require revoked compatibility',
      })
    }
    if (Date.parse(connection.updatedAt) < Date.parse(connection.createdAt)) {
      context.addIssue({ code: 'custom', message: 'Connection timestamps cannot regress' })
    }
  })

export type RuntimeNodeRef = z.output<typeof RuntimeNodeRefSchema>
export type RuntimeConnection = z.output<typeof RuntimeConnectionSchema>
export type RuntimeCompatibilityState = z.output<typeof RuntimeCompatibilityStateSchema>

export interface RuntimeCompatibilityResult {
  readonly state: RuntimeCompatibilityState
  readonly reasons: readonly string[]
}

export function assessRuntimeCompatibility(
  definitionInput: unknown,
  expected: {
    readonly contractMajor: number
    readonly adapterMajor: number
    readonly driverMajor: number
    readonly capabilities: readonly CapabilityRequirement[]
  }
): RuntimeCompatibilityResult {
  const definition = RuntimeDefinitionSchema.parse(definitionInput)
  if (definition.lifecycle === 'revoked') return { state: 'revoked', reasons: ['RUNTIME_REVOKED'] }
  if (definition.lifecycle === 'deprecated') {
    return { state: 'deprecated', reasons: ['RUNTIME_DEPRECATED'] }
  }
  if (definition.health === 'unavailable') {
    return { state: 'unavailable', reasons: ['RUNTIME_UNAVAILABLE'] }
  }
  if (definition.compatibility.status === 'incompatible') {
    return { state: 'incompatible', reasons: ['RUNTIME_DECLARED_INCOMPATIBLE'] }
  }
  const versionReasons = [
    ...(definition.compatibility.testedVersions.contractVersion.major === expected.contractMajor
      ? []
      : ['CONTRACT_MAJOR_MISMATCH']),
    ...(major(definition.adapterVersion) === expected.adapterMajor
      ? []
      : ['ADAPTER_MAJOR_MISMATCH']),
    ...(major(definition.driverVersion) === expected.driverMajor ? [] : ['DRIVER_MAJOR_MISMATCH']),
  ].sort()
  if (versionReasons.length > 0) return { state: 'incompatible', reasons: versionReasons }

  const capability = evaluateCapabilities(definition.capabilities, expected.capabilities)
  if (!capability.eligible) {
    return {
      state: 'capability_missing',
      reasons: [
        ...capability.missingRequired.map((name) => `MISSING_REQUIRED:${name}`),
        ...capability.insufficientRequired.map((name) => `INSUFFICIENT_REQUIRED:${name}`),
      ].sort(),
    }
  }
  if (definition.compatibility.status === 'untested') {
    return { state: 'untested', reasons: ['VERSION_COMBINATION_UNTESTED'] }
  }
  if (definition.health === 'degraded' || capability.mode === 'degraded') {
    return {
      state: 'degraded',
      reasons: [
        ...(definition.health === 'degraded' ? ['RUNTIME_HEALTH_DEGRADED'] : []),
        ...capability.missingOptional.map((name) => `MISSING_OPTIONAL:${name}`),
        ...capability.degradedOptional.map((name) => `DEGRADED_OPTIONAL:${name}`),
      ].sort(),
    }
  }
  return { state: 'compatible', reasons: [] }
}

export function runtimeDefinitionsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeDefinition(left)) === JSON.stringify(normalizeDefinition(right))
}

function normalizeDefinition(input: unknown): RuntimeDefinition {
  const definition = RuntimeDefinitionSchema.parse(input)
  return {
    ...definition,
    capabilities: [...definition.capabilities].sort((left, right) =>
      left.name.localeCompare(right.name)
    ),
  }
}

function major(version: string): number {
  return Number.parseInt(version.split('.')[0] ?? '', 10)
}

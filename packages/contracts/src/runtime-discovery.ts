import { z } from 'zod'
import { ServiceCallerAssertionSchema } from './authentication.js'
import { CorrelationMetadataSchema } from './envelopes.js'
import { IdentifierSchemas } from './identifiers.js'
import { ContractVersionSchema } from './versioning.js'

const TimestampSchema = z.iso.datetime()
const CapabilityNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9.-]*$/)
const DiagnosticCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]*$/)
const CursorSchema = z
  .string()
  .min(8)
  .max(512)
  .regex(/^cur_[A-Za-z0-9_-]+$/)
const SemanticVersionSchema = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
const unique = <Value>(values: Value[]) => new Set(values).size === values.length

const ReadRequestContextSchema = z.object({
  caller: ServiceCallerAssertionSchema,
  contractVersion: ContractVersionSchema,
  requestId: IdentifierSchemas.requestId,
  workspaceId: IdentifierSchemas.workspaceId,
  projectId: IdentifierSchemas.projectId.optional(),
  correlation: CorrelationMetadataSchema,
  requestedAt: TimestampSchema,
})

const ResponseContextSchema = z.object({
  contractVersion: ContractVersionSchema,
  requestId: IdentifierSchemas.requestId,
  correlation: CorrelationMetadataSchema,
})

export const DiscoveryFreshnessSchema = z.object({
  state: z.enum(['fresh', 'stale', 'expired', 'unknown']),
  observedAt: TimestampSchema,
  expiresAt: TimestampSchema.optional(),
})

const OperationAvailabilitySchema = z.union([
  z.object({ available: z.literal(true) }),
  z.object({
    available: z.literal(false),
    reason: DiagnosticCodeSchema,
  }),
])

export const RuntimeConnectionDiscoveryReadModelSchema = z.object({
  runtimeConnectionId: IdentifierSchemas.runtimeConnectionId,
  runtimeDefinitionId: IdentifierSchemas.runtimeDefinitionId,
  family: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9-]*$/),
  connectionType: z.enum(['managed_cloud', 'managed_local', 'external_local']),
  location: z.enum(['local_device', 'managed_sandbox']),
  status: z.enum(['available', 'degraded', 'unavailable', 'revoked']),
  node: z
    .object({
      runtimeNodeRefId: IdentifierSchemas.runtimeNodeRefId,
      location: z.enum(['local_device', 'remote_host', 'managed_sandbox']),
      status: z.enum(['online', 'offline', 'revoked']),
      health: z.enum(['online', 'offline', 'unknown', 'revoked']),
      observedAt: TimestampSchema,
    })
    .optional(),
  connection: z.object({
    status: z.enum(['connected', 'degraded', 'unavailable', 'disconnected', 'expired', 'revoked']),
    health: z.enum(['healthy', 'degraded', 'unavailable']),
    availability: z.enum([
      'healthy',
      'degraded',
      'reconnecting',
      'offline',
      'incompatible',
      'revoked',
      'stale',
      'unknown',
    ]),
  }),
  freshness: DiscoveryFreshnessSchema,
  versions: z.object({
    adapter: SemanticVersionSchema,
    driver: SemanticVersionSchema,
    harness: SemanticVersionSchema,
    protocol: SemanticVersionSchema.optional(),
  }),
  capabilities: z.array(CapabilityNameSchema).max(64).refine(unique),
  capabilityDetails: z
    .array(
      z.object({
        name: CapabilityNameSchema,
        support: z.enum(['supported', 'degraded', 'unsupported']),
        limitations: z.array(DiagnosticCodeSchema).max(32).optional(),
      })
    )
    .max(64),
  compatibility: z.object({
    state: z.enum([
      'compatible',
      'degraded',
      'untested',
      'incompatible',
      'deprecated',
      'revoked',
      'unavailable',
      'capability_missing',
    ]),
    limitations: z.array(DiagnosticCodeSchema).max(64),
  }),
  access: z.object({
    localProjectGrant: z.object({
      required: z.boolean(),
      state: z.enum(['not_required', 'granted', 'missing', 'revoked']),
    }),
    entitlement: z.object({
      state: z.enum(['allowed', 'denied', 'unknown']),
      class: z.string().min(1).max(64).optional(),
    }),
  }),
  eligibility: z.object({
    state: z.enum(['eligible', 'degraded', 'ineligible']),
    reasons: z.array(DiagnosticCodeSchema).max(128),
    degradations: z.array(DiagnosticCodeSchema).max(128),
    remediation: z
      .array(
        z.object({
          code: DiagnosticCodeSchema,
          label: z.string().min(1).max(160),
        })
      )
      .max(32),
  }),
  observedAt: TimestampSchema,
  limitations: z.array(DiagnosticCodeSchema).max(64),
})

export const ExternalSessionDiscoveryReadModelSchema = z.object({
  externalSessionId: IdentifierSchemas.externalSessionId,
  runtimeConnectionId: IdentifierSchemas.runtimeConnectionId,
  projectId: IdentifierSchemas.projectId.optional(),
  state: z.enum([
    'active',
    'closed',
    'stale',
    'offline',
    'runtime_missing',
    'capability_changed',
    'removed',
    'revoked',
  ]),
  recoverable: z.boolean(),
  display: z.object({
    origin: z.enum(['native_discovery', 'created_through_control_plane']),
    displayName: z.string().min(1).max(128).optional(),
  }),
  freshness: DiscoveryFreshnessSchema,
  capabilitySummary: z.object({
    version: z.number().int().positive(),
    operations: z.array(CapabilityNameSchema).max(16).refine(unique),
    controls: z.object({
      reference: OperationAvailabilitySchema,
      resume: OperationAvailabilitySchema,
      load: OperationAvailabilitySchema,
      close: OperationAvailabilitySchema,
      history: OperationAvailabilitySchema,
    }),
  }),
  limitations: z.array(DiagnosticCodeSchema).max(64),
})

const RuntimeConnectionListParametersSchema = z.object({
  cursor: CursorSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
  runtimeNodeRefId: IdentifierSchemas.runtimeNodeRefId.optional(),
  states: z
    .array(z.enum(['available', 'degraded', 'stale', 'incompatible', 'offline', 'revoked']))
    .max(6)
    .refine(unique)
    .default([]),
  requiredCapabilities: z.array(CapabilityNameSchema).max(64).refine(unique).default([]),
})

export const RuntimeConnectionListRequestSchema = ReadRequestContextSchema.extend({
  operation: z.literal('runtime-connection.list'),
  parameters: RuntimeConnectionListParametersSchema,
})

export const RuntimeConnectionGetRequestSchema = ReadRequestContextSchema.extend({
  operation: z.literal('runtime-connection.get'),
  parameters: z.object({
    runtimeConnectionId: IdentifierSchemas.runtimeConnectionId,
    runtimeNodeRefId: IdentifierSchemas.runtimeNodeRefId.optional(),
  }),
})

const PageSchema = z.object({ nextCursor: CursorSchema.optional() })

export const RuntimeConnectionListResponseSchema = ResponseContextSchema.extend({
  data: z.object({
    runtimeConnections: z.array(RuntimeConnectionDiscoveryReadModelSchema).max(100),
    page: PageSchema,
  }),
})

export const RuntimeConnectionGetResponseSchema = ResponseContextSchema.extend({
  data: z.object({ runtimeConnection: RuntimeConnectionDiscoveryReadModelSchema }),
})

export const ExternalSessionListRequestSchema = ReadRequestContextSchema.extend({
  operation: z.literal('external-session.list'),
  parameters: z.object({
    cursor: CursorSchema.optional(),
    limit: z.number().int().min(1).max(100).default(50),
    runtimeConnectionId: IdentifierSchemas.runtimeConnectionId.optional(),
    runtimeNodeRefId: IdentifierSchemas.runtimeNodeRefId.optional(),
    states: z
      .array(
        z.enum([
          'active',
          'closed',
          'stale',
          'offline',
          'runtime_missing',
          'capability_changed',
          'removed',
          'revoked',
        ])
      )
      .max(8)
      .refine(unique)
      .default([]),
  }),
})

export const ExternalSessionGetRequestSchema = ReadRequestContextSchema.extend({
  operation: z.literal('external-session.get'),
  parameters: z.object({
    externalSessionId: IdentifierSchemas.externalSessionId,
    runtimeNodeRefId: IdentifierSchemas.runtimeNodeRefId.optional(),
  }),
})

export const ExternalSessionListResponseSchema = ResponseContextSchema.extend({
  data: z.object({
    externalSessions: z.array(ExternalSessionDiscoveryReadModelSchema).max(100),
    page: PageSchema,
  }),
})

export const ExternalSessionGetResponseSchema = ResponseContextSchema.extend({
  data: z.object({ externalSession: ExternalSessionDiscoveryReadModelSchema }),
})

export type RuntimeConnectionDiscoveryReadModel = z.output<
  typeof RuntimeConnectionDiscoveryReadModelSchema
>
export type ExternalSessionDiscoveryReadModel = z.output<
  typeof ExternalSessionDiscoveryReadModelSchema
>
export type RuntimeConnectionListRequest = z.input<typeof RuntimeConnectionListRequestSchema>
export type RuntimeConnectionListResponse = z.output<typeof RuntimeConnectionListResponseSchema>
export type RuntimeConnectionGetRequest = z.input<typeof RuntimeConnectionGetRequestSchema>
export type RuntimeConnectionGetResponse = z.output<typeof RuntimeConnectionGetResponseSchema>
export type ExternalSessionListRequest = z.input<typeof ExternalSessionListRequestSchema>
export type ExternalSessionListResponse = z.output<typeof ExternalSessionListResponseSchema>
export type ExternalSessionGetRequest = z.input<typeof ExternalSessionGetRequestSchema>
export type ExternalSessionGetResponse = z.output<typeof ExternalSessionGetResponseSchema>

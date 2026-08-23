import { z } from 'zod'
import { ServiceCallerAssertionSchema } from './authentication.js'
import { CorrelationMetadataSchema } from './envelopes.js'
import { IdentifierSchemas } from './identifiers.js'
import { ContractVersionSchema } from './versioning.js'

const TimestampSchema = z.iso.datetime()
const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const IdempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/)
const PayloadHashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const CapabilityNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9.-]*$/)

const RequestContextSchema = z.object({
  caller: ServiceCallerAssertionSchema,
  contractVersion: ContractVersionSchema,
  requestId: IdentifierSchemas.requestId,
  workspaceId: IdentifierSchemas.workspaceId,
  projectId: IdentifierSchemas.projectId.optional(),
  correlation: CorrelationMetadataSchema,
})

const CommandContextSchema = RequestContextSchema.extend({
  commandId: IdentifierSchemas.commandId,
  idempotencyKey: IdempotencyKeySchema,
  payloadHash: PayloadHashSchema,
})

const ResponseContextSchema = z.object({
  contractVersion: ContractVersionSchema,
  requestId: IdentifierSchemas.requestId,
  correlation: CorrelationMetadataSchema,
})

const successResponse = <Data extends z.ZodType>(data: Data) =>
  ResponseContextSchema.extend({ data })

export const ProjectStateReferenceSchema = z
  .object({
    workspaceId: IdentifierSchemas.workspaceId,
    projectId: IdentifierSchemas.projectId,
    revision: z.number().int().nonnegative(),
  })
  .strict()

export type ProjectStateReference = z.output<typeof ProjectStateReferenceSchema>

export const ContextPackagePublicReferenceSchema = z
  .object({
    contextPackageId: IdentifierSchemas.contextPackageId,
    contentDigest: DigestSchema,
    schemaVersion: z.number().int().positive(),
    compilerVersion: z.string().min(1).max(64),
  })
  .strict()

export type ContextPackagePublicReference = z.output<typeof ContextPackagePublicReferenceSchema>

export const PolicySnapshotPublicReferenceSchema = z
  .object({
    policySnapshotId: z.string().min(1).max(256),
    revision: z.number().int().positive(),
    contentDigest: DigestSchema,
  })
  .strict()

export type PolicySnapshotPublicReference = z.output<typeof PolicySnapshotPublicReferenceSchema>

export const ExecutionPlanPublicReferenceSchema = z
  .object({
    executionPlanId: IdentifierSchemas.executionPlanId,
    contentDigest: DigestSchema,
  })
  .strict()

export type ExecutionPlanPublicReference = z.output<typeof ExecutionPlanPublicReferenceSchema>

export const ServiceAuthenticationRequestSchema = RequestContextSchema.extend({
  operation: z.literal('authentication.verify'),
  requestedAt: TimestampSchema,
})

export const ServiceAuthenticationResponseSchema = successResponse(
  z.object({
    authenticated: z.literal(true),
    principal: z.object({
      kind: z.literal('agent_hq_service'),
      principalId: z.string().regex(/^svc_[a-z][a-z0-9-]*$/),
      scopes: z.array(z.string().min(1).max(96)).max(64),
      workspaceIds: z.array(IdentifierSchemas.workspaceId).max(256),
      projectIds: z.array(IdentifierSchemas.projectId).max(256),
    }),
  })
)

export const ProfileResolutionRequestSchema = RequestContextSchema.extend({
  operation: z.literal('profile.resolve'),
  requestedAt: TimestampSchema,
  parameters: z
    .object({
      profileId: IdentifierSchemas.profileId,
      profileVersionId: IdentifierSchemas.profileVersionId.optional(),
    })
    .strict(),
})

export const ProfileResolutionResponseSchema = successResponse(
  z.object({
    profile: z
      .object({
        profileId: IdentifierSchemas.profileId,
        profileVersionId: IdentifierSchemas.profileVersionId,
        version: z.number().int().positive(),
        revision: z.number().int().positive(),
        schemaVersion: z.number().int().positive(),
        contentDigest: DigestSchema,
        lifecycle: z.literal('published'),
      })
      .strict(),
    skillVersionIds: z.array(IdentifierSchemas.skillVersionId).max(128),
  })
)

export const ProjectStateResolutionRequestSchema = RequestContextSchema.extend({
  operation: z.literal('project-state.resolve'),
  requestedAt: TimestampSchema,
  parameters: z.object({ revision: z.number().int().nonnegative().optional() }).strict(),
})

export const ProjectStateResolutionResponseSchema = successResponse(
  z.object({ projectState: ProjectStateReferenceSchema })
)

export const ContextPackageResolutionRequestSchema = RequestContextSchema.extend({
  operation: z.literal('context-package.resolve'),
  requestedAt: TimestampSchema,
  parameters: z.object({ contextPackageId: IdentifierSchemas.contextPackageId }).strict(),
})

export const ContextPackageResolutionResponseSchema = successResponse(
  z.object({ contextPackage: ContextPackagePublicReferenceSchema })
)

export const RuntimeReadModelSchema = z
  .object({
    runtimeNodeRefId: IdentifierSchemas.runtimeNodeRefId,
    runtimeConnectionId: IdentifierSchemas.runtimeConnectionId.optional(),
    runtimeDefinitionId: IdentifierSchemas.runtimeDefinitionId,
    family: z.string().min(1).max(64),
    location: z.enum(['local_device', 'remote_host', 'managed_sandbox']),
    status: z.enum(['available', 'degraded', 'unavailable', 'revoked']),
    observedAt: TimestampSchema,
    capabilities: z.array(CapabilityNameSchema).max(128),
    limitations: z.array(z.string().min(1).max(512)).max(64),
  })
  .strict()

export type RuntimeReadModel = z.output<typeof RuntimeReadModelSchema>

export const RuntimeListRequestSchema = RequestContextSchema.extend({
  operation: z.literal('runtime.list'),
  requestedAt: TimestampSchema,
  parameters: z
    .object({
      status: z.enum(['available', 'degraded', 'unavailable', 'revoked']).optional(),
      requiredCapabilities: z.array(CapabilityNameSchema).max(128),
    })
    .strict(),
})

export const RuntimeListResponseSchema = successResponse(
  z.object({ runtimes: z.array(RuntimeReadModelSchema).max(1_000) })
)

export const ExecutionRequestValidationRequestSchema = CommandContextSchema.extend({
  operation: z.literal('execution.validate'),
  issuedAt: TimestampSchema,
  payload: z
    .object({
      taskId: IdentifierSchemas.taskId,
      agentId: IdentifierSchemas.agentId,
      profileVersionId: IdentifierSchemas.profileVersionId,
      skillVersionIds: z.array(IdentifierSchemas.skillVersionId).max(128),
      projectState: ProjectStateReferenceSchema,
      contextPackage: ContextPackagePublicReferenceSchema,
      policySnapshot: PolicySnapshotPublicReferenceSchema,
      runtimeRequirements: z.array(CapabilityNameSchema).max(128),
      outputContractRef: z.string().min(1).max(512),
    })
    .strict(),
})

export const ExecutionRequestValidationResponseSchema = successResponse(
  z.object({
    valid: z.literal(true),
    executionPlan: ExecutionPlanPublicReferenceSchema,
  })
)

export type ServiceAuthenticationRequest = z.input<typeof ServiceAuthenticationRequestSchema>
export type ServiceAuthenticationResponse = z.output<typeof ServiceAuthenticationResponseSchema>
export type ProfileResolutionRequest = z.input<typeof ProfileResolutionRequestSchema>
export type ProfileResolutionResponse = z.output<typeof ProfileResolutionResponseSchema>
export type ProjectStateResolutionRequest = z.input<typeof ProjectStateResolutionRequestSchema>
export type ProjectStateResolutionResponse = z.output<typeof ProjectStateResolutionResponseSchema>
export type ContextPackageResolutionRequest = z.input<typeof ContextPackageResolutionRequestSchema>
export type ContextPackageResolutionResponse = z.output<
  typeof ContextPackageResolutionResponseSchema
>
export type RuntimeListRequest = z.input<typeof RuntimeListRequestSchema>
export type RuntimeListResponse = z.output<typeof RuntimeListResponseSchema>
export type ExecutionRequestValidationRequest = z.input<
  typeof ExecutionRequestValidationRequestSchema
>
export type ExecutionRequestValidationResponse = z.output<
  typeof ExecutionRequestValidationResponseSchema
>

const contractVersion = { major: 1, minor: 0 } as const
const requestId = 'req_01JABCDEF0123456789ABCDEFG'
const commandId = 'cmd_01JABCDEF0123456789ABCDEFG'
const workspaceId = 'wsp_01JABCDEF0123456789ABCDEFG'
const projectId = 'prj_01JABCDEF0123456789ABCDEFG'
const traceId = 'trc_01JABCDEF0123456789ABCDEFG'
const caller = { servicePrincipalId: 'svc_agent-hq' }
const requestContext = {
  caller,
  contractVersion,
  requestId,
  workspaceId,
  projectId,
  correlation: { traceId },
}
const responseContext = { contractVersion, requestId, correlation: { traceId } }
const projectStateReference = { workspaceId, projectId, revision: 7 }
const contextPackageReference = {
  contextPackageId: 'ctx_01JABCDEF0123456789ABCDEFG',
  contentDigest: `sha256:${'b'.repeat(64)}`,
  schemaVersion: 1,
  compilerVersion: '1.0.0',
}

export interface ControlApiFixtureSet {
  readonly authentication: {
    readonly request: ServiceAuthenticationRequest
    readonly response: z.input<typeof ServiceAuthenticationResponseSchema>
  }
  readonly profileResolution: {
    readonly request: ProfileResolutionRequest
    readonly response: z.input<typeof ProfileResolutionResponseSchema>
  }
  readonly projectStateReference: z.input<typeof ProjectStateReferenceSchema>
  readonly contextPackageReference: z.input<typeof ContextPackagePublicReferenceSchema>
  readonly projectStateResolution: {
    readonly request: ProjectStateResolutionRequest
    readonly response: z.input<typeof ProjectStateResolutionResponseSchema>
  }
  readonly contextPackageResolution: {
    readonly request: ContextPackageResolutionRequest
    readonly response: z.input<typeof ContextPackageResolutionResponseSchema>
  }
  readonly runtimeList: {
    readonly request: RuntimeListRequest
    readonly response: z.input<typeof RuntimeListResponseSchema>
  }
  readonly executionValidation: {
    readonly request: ExecutionRequestValidationRequest
    readonly response: z.input<typeof ExecutionRequestValidationResponseSchema>
  }
}

export const ControlApiFixtures: ControlApiFixtureSet = Object.freeze({
  authentication: {
    request: {
      ...requestContext,
      operation: 'authentication.verify',
      requestedAt: '2026-08-23T12:00:00.000Z',
    },
    response: {
      ...responseContext,
      data: {
        authenticated: true,
        principal: {
          kind: 'agent_hq_service',
          principalId: 'svc_agent-hq',
          scopes: ['profile:resolve', 'runtime:read', 'execution:validate'],
          workspaceIds: [workspaceId],
          projectIds: [projectId],
        },
      },
    },
  },
  profileResolution: {
    request: {
      ...requestContext,
      operation: 'profile.resolve',
      requestedAt: '2026-08-23T12:00:00.000Z',
      parameters: { profileId: 'prf_01JABCDEF0123456789ABCDEFG' },
    },
    response: {
      ...responseContext,
      data: {
        profile: {
          profileId: 'prf_01JABCDEF0123456789ABCDEFG',
          profileVersionId: 'pfv_01JABCDEF0123456789ABCDEFG',
          version: 3,
          revision: 2,
          schemaVersion: 1,
          contentDigest: `sha256:${'a'.repeat(64)}`,
          lifecycle: 'published',
        },
        skillVersionIds: ['skv_01JABCDEF0123456789ABCDEFG'],
      },
    },
  },
  projectStateReference,
  contextPackageReference,
  projectStateResolution: {
    request: {
      ...requestContext,
      operation: 'project-state.resolve',
      requestedAt: '2026-08-23T12:00:00.000Z',
      parameters: { revision: 7 },
    },
    response: { ...responseContext, data: { projectState: projectStateReference } },
  },
  contextPackageResolution: {
    request: {
      ...requestContext,
      operation: 'context-package.resolve',
      requestedAt: '2026-08-23T12:00:00.000Z',
      parameters: { contextPackageId: contextPackageReference.contextPackageId },
    },
    response: { ...responseContext, data: { contextPackage: contextPackageReference } },
  },
  runtimeList: {
    request: {
      ...requestContext,
      operation: 'runtime.list',
      requestedAt: '2026-08-23T12:00:00.000Z',
      parameters: { status: 'available', requiredCapabilities: ['tool.call'] },
    },
    response: {
      ...responseContext,
      data: {
        runtimes: [
          {
            runtimeNodeRefId: 'rnr_01JABCDEF0123456789ABCDEFG',
            runtimeConnectionId: 'rtc_01JABCDEF0123456789ABCDEFG',
            runtimeDefinitionId: 'rtd_01JABCDEF0123456789ABCDEFG',
            family: 'mock',
            location: 'managed_sandbox',
            status: 'available',
            observedAt: '2026-08-23T12:00:00.000Z',
            capabilities: ['tool.call'],
            limitations: [],
          },
        ],
      },
    },
  },
  executionValidation: {
    request: {
      ...requestContext,
      commandId,
      idempotencyKey: 'intent-01JABCDEF0123456789ABCDEFG',
      payloadHash: 'c'.repeat(64),
      operation: 'execution.validate',
      issuedAt: '2026-08-23T12:00:00.000Z',
      payload: {
        taskId: 'tsk_01JABCDEF0123456789ABCDEFG',
        agentId: 'agt_01JABCDEF0123456789ABCDEFG',
        profileVersionId: 'pfv_01JABCDEF0123456789ABCDEFG',
        skillVersionIds: ['skv_01JABCDEF0123456789ABCDEFG'],
        projectState: projectStateReference,
        contextPackage: contextPackageReference,
        policySnapshot: {
          policySnapshotId: 'policy-snapshot-2026-08-23',
          revision: 4,
          contentDigest: `sha256:${'d'.repeat(64)}`,
        },
        runtimeRequirements: ['tool.call'],
        outputContractRef: 'agent-hq://contracts/task-result/v1',
      },
    },
    response: {
      ...responseContext,
      data: {
        valid: true,
        executionPlan: {
          executionPlanId: 'pln_01JABCDEF0123456789ABCDEFG',
          contentDigest: `sha256:${'e'.repeat(64)}`,
        },
      },
    },
  },
} satisfies ControlApiFixtureSet)

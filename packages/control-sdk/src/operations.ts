import {
  ContextPackageResolutionRequestSchema,
  ContextPackageResolutionResponseSchema,
  ExecutionRequestValidationRequestSchema,
  ExecutionRequestValidationResponseSchema,
  ProfileResolutionRequestSchema,
  ProfileResolutionResponseSchema,
  ProjectStateResolutionRequestSchema,
  ProjectStateResolutionResponseSchema,
  RuntimeListRequestSchema,
  RuntimeListResponseSchema,
  ServiceAuthenticationRequestSchema,
  ServiceAuthenticationResponseSchema,
} from '@control-plane/contracts'

export const ControlApiOperations = Object.freeze({
  verifyAuthentication: {
    operation: 'authentication.verify',
    method: 'POST',
    path: '/v1/authentication/verify',
    requestSchema: ServiceAuthenticationRequestSchema,
    responseSchema: ServiceAuthenticationResponseSchema,
  },
  resolveProfile: {
    operation: 'profile.resolve',
    method: 'POST',
    path: '/v1/profiles/resolve',
    requestSchema: ProfileResolutionRequestSchema,
    responseSchema: ProfileResolutionResponseSchema,
  },
  resolveProjectState: {
    operation: 'project-state.resolve',
    method: 'POST',
    path: '/v1/project-states/resolve',
    requestSchema: ProjectStateResolutionRequestSchema,
    responseSchema: ProjectStateResolutionResponseSchema,
  },
  resolveContextPackage: {
    operation: 'context-package.resolve',
    method: 'POST',
    path: '/v1/context-packages/resolve',
    requestSchema: ContextPackageResolutionRequestSchema,
    responseSchema: ContextPackageResolutionResponseSchema,
  },
  listRuntimes: {
    operation: 'runtime.list',
    method: 'POST',
    path: '/v1/runtimes/list',
    requestSchema: RuntimeListRequestSchema,
    responseSchema: RuntimeListResponseSchema,
  },
  validateExecutionRequest: {
    operation: 'execution.validate',
    method: 'POST',
    path: '/v1/executions/validate',
    requestSchema: ExecutionRequestValidationRequestSchema,
    responseSchema: ExecutionRequestValidationResponseSchema,
  },
})

export type ControlApiOperationName = keyof typeof ControlApiOperations

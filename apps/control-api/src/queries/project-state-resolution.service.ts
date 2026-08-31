import { NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import {
  ProjectStateResolutionRequestSchema,
  ProjectStateResolutionResponseSchema,
} from '@control-plane/contracts'
import type { ProjectStateRepository } from '@control-plane/domain'

export const PROJECT_STATE_RESOLUTION_SERVICE = Symbol('PROJECT_STATE_RESOLUTION_SERVICE')

export interface ProjectStateResolutionService {
  resolve(input: unknown): Promise<unknown>
}

export class UnavailableProjectStateResolutionService implements ProjectStateResolutionService {
  async resolve(): Promise<never> {
    throw new ServiceUnavailableException({
      code: 'PROJECT_STATE_RESOLUTION_NOT_CONFIGURED',
      message: 'ProjectState resolution is not configured',
    })
  }
}

export class RepositoryProjectStateResolutionService implements ProjectStateResolutionService {
  constructor(private readonly states: Pick<ProjectStateRepository, 'get' | 'getAtRevision'>) {}

  async resolve(inputValue: unknown) {
    const input = ProjectStateResolutionRequestSchema.parse(inputValue)
    if (input.projectId === undefined) {
      throw new NotFoundException({
        code: 'PROJECT_STATE_NOT_FOUND',
        message: 'ProjectState was not found',
      })
    }
    const state =
      input.parameters.revision === undefined
        ? await this.states.get(input.workspaceId, input.projectId)
        : await this.states.getAtRevision(
            input.workspaceId,
            input.projectId,
            input.parameters.revision
          )
    if (state === undefined) {
      throw new NotFoundException({
        code: 'PROJECT_STATE_NOT_FOUND',
        message: 'ProjectState was not found',
      })
    }
    return ProjectStateResolutionResponseSchema.parse({
      contractVersion: input.contractVersion,
      requestId: input.requestId,
      correlation: input.correlation,
      data: {
        projectState: {
          workspaceId: state.workspaceId,
          projectId: state.projectId,
          revision: state.revision,
        },
      },
    })
  }
}

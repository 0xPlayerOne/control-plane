import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { RequireServiceAuthentication } from '../auth/service-authentication.js'
import {
  PROJECT_STATE_RESOLUTION_SERVICE,
  type ProjectStateResolutionService,
} from './project-state-resolution.service.js'

@ApiTags('project state')
@Controller({ path: 'project-states', version: '1' })
@RequireServiceAuthentication('project-state:read')
export class ProjectStateResolutionController {
  constructor(
    @Inject(PROJECT_STATE_RESOLUTION_SERVICE)
    private readonly service: ProjectStateResolutionService
  ) {}

  @Post('resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve an immutable ProjectState revision' })
  @ApiOkResponse({ description: 'Workspace-safe ProjectState reference' })
  resolve(@Body() envelope: unknown) {
    return this.service.resolve(envelope)
  }
}

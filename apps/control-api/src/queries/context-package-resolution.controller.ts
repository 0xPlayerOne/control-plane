import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { RequireServiceAuthentication } from '../auth/service-authentication.js'
import {
  CONTEXT_PACKAGE_RESOLUTION_SERVICE,
  type ContextPackageResolutionService,
} from './context-package-resolution.service.js'

@ApiTags('context packages')
@Controller({ path: 'context-packages', version: '1' })
@RequireServiceAuthentication('context:read')
export class ContextPackageResolutionController {
  constructor(
    @Inject(CONTEXT_PACKAGE_RESOLUTION_SERVICE)
    private readonly service: ContextPackageResolutionService
  ) {}

  @Post('resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve an immutable scoped ContextPackage reference' })
  @ApiOkResponse({ description: 'Scoped ContextPackage public reference' })
  resolve(@Body() envelope: unknown) {
    return this.service.resolve(envelope)
  }
}

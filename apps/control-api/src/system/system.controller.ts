import { Controller, Get, Query, Req } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { FastifyRequest } from 'fastify'
import { RequireServiceAuthentication } from '../auth/service-authentication.js'
import { responseMetadata } from '../http/request-context.js'
import { EchoQuery } from './echo.dto.js'
import { SystemService } from './system.service.js'

@ApiTags('system')
@Controller({ path: 'system', version: '1' })
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  @Get('echo')
  @ApiOperation({ summary: 'Verify the versioned request stack' })
  @ApiOkResponse({ description: 'Validated echo response with request metadata' })
  echo(@Query() query: EchoQuery, @Req() request: FastifyRequest) {
    return { data: this.systemService.echo(query.message), meta: responseMetadata(request) }
  }

  @Get('authenticated')
  @RequireServiceAuthentication()
  authenticated() {
    return { data: { authenticated: true } }
  }
}

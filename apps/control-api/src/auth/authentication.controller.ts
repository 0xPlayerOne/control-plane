import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import {
  ServiceAuthenticationRequestSchema,
  ServiceAuthenticationResponseSchema,
} from '@control-plane/contracts'
import type { FastifyRequest } from 'fastify'
import { RequireServiceAuthentication } from './service-authentication.js'

@ApiTags('authentication')
@Controller({ path: 'authentication', version: '1' })
export class AuthenticationController {
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @RequireServiceAuthentication('system:authenticate')
  @ApiOperation({ summary: 'Verify a scoped service credential' })
  @ApiOkResponse({ description: 'Authenticated service principal and effective authority' })
  verify(@Body() envelope: unknown, @Req() request: FastifyRequest) {
    const input = ServiceAuthenticationRequestSchema.parse(envelope)
    return ServiceAuthenticationResponseSchema.parse({
      contractVersion: input.contractVersion,
      requestId: input.requestId,
      correlation: input.correlation,
      data: {
        authenticated: true,
        principal: request.servicePrincipal,
      },
    })
  }
}

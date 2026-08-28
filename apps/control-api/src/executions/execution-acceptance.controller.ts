import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req } from '@nestjs/common'
import { ApiAcceptedResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { FastifyRequest } from 'fastify'
import { RequireServiceAuthentication } from '../auth/service-authentication.js'
import {
  EXECUTION_ACCEPTANCE_SERVICE,
  type ExecutionAcceptanceService,
} from './execution-acceptance.service.js'

@ApiTags('executions')
@Controller({ path: 'executions', version: '1' })
@RequireServiceAuthentication('execution:accept')
export class ExecutionAcceptanceController {
  constructor(
    @Inject(EXECUTION_ACCEPTANCE_SERVICE)
    private readonly service: ExecutionAcceptanceService
  ) {}

  @Post('accept')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Accept and durably dispatch an execution' })
  @ApiAcceptedResponse({ description: 'Durable execution acceptance status' })
  accept(@Body() envelope: unknown, @Req() request: FastifyRequest) {
    return this.service.accept(envelope, request.servicePrincipal?.principalId ?? '')
  }
}

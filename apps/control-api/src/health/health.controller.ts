import { Controller, Get, Inject, VERSION_NEUTRAL } from '@nestjs/common'
import { ApiOkResponse, ApiTags } from '@nestjs/swagger'
import type { HealthResponse, ReadinessResponse } from '@control-plane/bootstrap'
import { API_HEALTH, API_READINESS } from '../http/tokens.js'

@ApiTags('service-status')
@Controller({ path: '', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    @Inject(API_HEALTH) private readonly healthState: () => HealthResponse,
    @Inject(API_READINESS) private readonly readinessState: () => ReadinessResponse
  ) {}

  @Get('health')
  @ApiOkResponse({ description: 'Service liveness and build metadata' })
  health(): HealthResponse {
    return this.healthState()
  }

  @Get('ready')
  @ApiOkResponse({ description: 'Service readiness and build metadata' })
  ready(): ReadinessResponse {
    return this.readinessState()
  }
}

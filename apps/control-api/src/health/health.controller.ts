import { Controller, Get, Inject, Res, VERSION_NEUTRAL } from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import { ApiOkResponse, ApiTags } from '@nestjs/swagger'
import type { HealthResponse, ReadinessResponse } from '@control-plane/bootstrap'
import { API_DEPENDENCY_READINESS, API_HEALTH, API_READINESS } from '../http/tokens.js'

@ApiTags('service-status')
@Controller({ path: '', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    @Inject(API_HEALTH) private readonly healthState: () => HealthResponse,
    @Inject(API_READINESS) private readonly readinessState: () => ReadinessResponse,
    @Inject(API_DEPENDENCY_READINESS)
    private readonly dependencyReadiness: () => Promise<boolean>
  ) {}

  @Get('health')
  @ApiOkResponse({ description: 'Service liveness and build metadata' })
  health(): HealthResponse {
    return this.healthState()
  }

  @Get('ready')
  @ApiOkResponse({ description: 'Service readiness and build metadata' })
  async ready(@Res({ passthrough: true }) response: FastifyReply): Promise<ReadinessResponse> {
    const state = this.readinessState()
    const dependenciesReady = await this.dependencyReadiness().catch(() => false)
    const ready = state.status === 'ready' && dependenciesReady
    response.status(ready ? 200 : 503)
    return ready ? state : { ...state, status: 'not_ready' }
  }
}

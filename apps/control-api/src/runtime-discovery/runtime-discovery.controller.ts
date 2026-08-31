import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { RequireServiceAuthentication } from '../auth/service-authentication.js'
import { RuntimeDiscoveryService } from './runtime-discovery.service.js'

@ApiTags('runtime discovery')
@Controller({ version: '1' })
@RequireServiceAuthentication('runtime:read')
export class RuntimeDiscoveryController {
  constructor(private readonly service: RuntimeDiscoveryService) {}

  @Post('runtimes/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List workspace-scoped runtime nodes' })
  @ApiOkResponse({ description: 'Normalized runtime node read models' })
  listRuntimes(@Body() envelope: unknown) {
    return this.service.listRuntimes(envelope)
  }

  @Post('runtime-connections/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List workspace-scoped normalized runtime connections' })
  @ApiOkResponse({ description: 'Paginated runtime connection discovery read models' })
  listRuntimeConnections(@Body() envelope: unknown) {
    return this.service.listRuntimeConnections(envelope)
  }

  @Post('runtime-connections/get')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get one workspace-scoped normalized runtime connection' })
  @ApiOkResponse({ description: 'Runtime connection discovery read model' })
  getRuntimeConnection(@Body() envelope: unknown) {
    return this.service.getRuntimeConnection(envelope)
  }

  @Post('external-sessions/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List scoped external session capability summaries' })
  @ApiOkResponse({ description: 'Paginated external session capability summaries' })
  listExternalSessions(@Body() envelope: unknown) {
    return this.service.listExternalSessions(envelope)
  }

  @Post('external-sessions/get')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get one scoped external session capability summary' })
  @ApiOkResponse({ description: 'External session capability summary' })
  getExternalSession(@Body() envelope: unknown) {
    return this.service.getExternalSession(envelope)
  }
}

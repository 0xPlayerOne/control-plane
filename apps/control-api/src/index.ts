import {
  bootstrapService,
  jsonLogger,
  type ProcessAdapter,
  type ServiceRuntime,
  type StructuredLogger,
} from '@control-plane/bootstrap'
import type { RawEnvironment } from '@control-plane/config'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { createControlApiApplication } from './application.js'

export const serviceName = 'control-api'

export interface ControlApiStartOptions {
  readonly cwd?: string
  readonly environment?: RawEnvironment
  readonly listen?: boolean
  readonly logger?: StructuredLogger
  readonly processAdapter?: ProcessAdapter
}

export interface StartedControlApi {
  readonly application: NestFastifyApplication
  readonly runtime: ServiceRuntime<'control-api'>
}

export async function start(options: ControlApiStartOptions = {}): Promise<StartedControlApi> {
  const logger = options.logger ?? jsonLogger
  let application: NestFastifyApplication | undefined
  const runtime = await bootstrapService({
    serviceName,
    logger,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.environment === undefined ? {} : { environment: options.environment }),
    ...(options.processAdapter === undefined ? {} : { processAdapter: options.processAdapter }),
    start: async ({ config, health, markReady, metadata, readiness, registerResource }) => {
      application = await createControlApiApplication({ health, logger, metadata, readiness })
      registerResource('control-api-http', () => application?.close())
      if (options.listen !== false) {
        await application.listen({ host: '0.0.0.0', port: config.values.port })
      }
      markReady()
    },
  })
  if (!application) throw new Error('Control API application did not initialize')
  return { application, runtime }
}

export { createControlApiApplication, createOpenApiDocument } from './application.js'

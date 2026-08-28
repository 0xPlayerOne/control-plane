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
import type { ServiceAuthenticator } from './auth/service-authentication.js'
import {
  createManagedCloudControlApiComposition,
  type PostgresConnectionFactory,
} from './cloud-composition.js'
import type { ExecutionValidationService } from './executions/execution-validation.service.js'
import type { ExecutionAcceptanceService } from './executions/execution-acceptance.service.js'
import type { RuntimeDiscoveryRepository } from './runtime-discovery/runtime-discovery.repository.js'

export const serviceName = 'control-api'

export interface ControlApiStartOptions {
  readonly cwd?: string
  readonly environment?: RawEnvironment
  readonly executionAcceptanceService?: ExecutionAcceptanceService
  readonly executionValidationService?: ExecutionValidationService
  readonly listen?: boolean
  readonly logger?: StructuredLogger
  readonly processAdapter?: ProcessAdapter
  readonly postgresConnectionFactory?: PostgresConnectionFactory
  readonly runtimeDiscoveryRepository?: RuntimeDiscoveryRepository
  readonly serviceAuthenticator?: ServiceAuthenticator
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
    start: async ({
      config,
      health,
      managedCloud,
      markReady,
      metadata,
      readiness,
      registerResource,
    }) => {
      const cloudComposition =
        managedCloud === undefined
          ? undefined
          : createManagedCloudControlApiComposition(
              managedCloud,
              logger,
              options.postgresConnectionFactory
            )
      if (cloudComposition !== undefined) {
        registerResource('control-api-postgres', () => cloudComposition.connection.close())
        await cloudComposition.connection.check()
      }
      const executionValidationService =
        options.executionValidationService ?? cloudComposition?.executionValidationService
      const executionAcceptanceService =
        options.executionAcceptanceService ?? cloudComposition?.executionAcceptanceService
      const serviceAuthenticator =
        options.serviceAuthenticator ?? cloudComposition?.serviceAuthenticator
      application = await createControlApiApplication({
        ...(executionAcceptanceService === undefined ? {} : { executionAcceptanceService }),
        ...(executionValidationService === undefined ? {} : { executionValidationService }),
        health,
        logger,
        metadata,
        readiness,
        ...(options.runtimeDiscoveryRepository === undefined
          ? {}
          : { runtimeDiscoveryRepository: options.runtimeDiscoveryRepository }),
        ...(serviceAuthenticator === undefined ? {} : { serviceAuthenticator }),
      })
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
export { createManagedCloudControlApiComposition } from './cloud-composition.js'

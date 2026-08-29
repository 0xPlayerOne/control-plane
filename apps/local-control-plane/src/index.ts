import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  bootstrapService,
  jsonLogger,
  type ProcessAdapter,
  type StructuredLogger,
} from '@control-plane/bootstrap'
import type { RawEnvironment } from '@control-plane/config'
import { createControlApiApplication } from '@control-plane/control-api'
import {
  LocalControlPlaneComposition,
  type LocalControlPlaneCompositionOptions,
} from './composition.js'
import { createLocalApiAuthentication } from './authentication.js'
import { LocalControlApiComposition } from './local-api-composition.js'

export const serviceName = 'local-control-plane'

export interface LocalControlPlaneStartOptions {
  readonly environment?: RawEnvironment
  readonly logger?: StructuredLogger
  readonly processAdapter?: ProcessAdapter
  readonly composition?: LocalControlPlaneComposition
  readonly compositionOptions?: Omit<LocalControlPlaneCompositionOptions, 'dataDirectory'> & {
    readonly dataDirectory?: string
  }
}

export const start = (options: LocalControlPlaneStartOptions = {}) =>
  bootstrapService({
    serviceName,
    logger: options.logger ?? jsonLogger,
    ...(options.environment === undefined ? {} : { environment: options.environment }),
    ...(options.processAdapter === undefined ? {} : { processAdapter: options.processAdapter }),
    start: async ({ config, health, markReady, readiness, registerResource }) => {
      const composition =
        options.composition ??
        new LocalControlPlaneComposition({
          dataDirectory:
            options.compositionOptions?.dataDirectory ??
            process.env['CONTROL_PLANE_DATA_DIR'] ??
            join(homedir(), '.control-plane'),
          ...options.compositionOptions,
        })
      registerResource('local-control-plane-composition', () => composition.close())
      await composition.start()
      const localApi = new LocalControlApiComposition(
        composition.persistence,
        (await composition.discovery.resolve('restate')).url.toString()
      )
      const authentication = await createLocalApiAuthentication(composition.dataDirectory)
      const application = await createControlApiApplication({
        executionAcceptanceService: localApi.executionAcceptanceService,
        executionValidationService: localApi.executionValidationService,
        serviceAuthenticator: authentication.authenticator,
        componentManifest: () => composition.manifest(),
        health,
        logger: options.logger ?? jsonLogger,
        metadata: config.metadata,
        readiness,
      })
      registerResource('local-control-plane-api', () => application.close())
      await application.listen({ host: '127.0.0.1', port: config.values.port })
      markReady()
    },
  })

export * from './composition.js'
export * from './server.js'
export * from './authentication.js'
export * from './local-api-composition.js'
export * from './direct-runtime-activities.js'

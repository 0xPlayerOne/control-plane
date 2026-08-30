import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  bootstrapService,
  jsonLogger,
  type ProcessAdapter,
  type StructuredLogger,
} from '@control-plane/bootstrap'
import type { RawEnvironment } from '@control-plane/config'
import {
  createControlApiApplication,
  createPrivateApiAuthentication,
} from '@control-plane/control-api'
import {
  HostedServerControlPlaneComposition,
  type HostedServerCompositionOptions,
} from './composition.js'

export const serviceName = 'hosted-control-plane'

export interface HostedControlPlaneStartOptions {
  readonly apiHost?: string
  readonly environment?: RawEnvironment
  readonly logger?: StructuredLogger
  readonly processAdapter?: ProcessAdapter
  readonly composition?: HostedServerControlPlaneComposition
  readonly compositionOptions?: Partial<HostedServerCompositionOptions>
}

export const start = (options: HostedControlPlaneStartOptions = {}) =>
  bootstrapService({
    serviceName,
    logger: options.logger ?? jsonLogger,
    ...(options.environment === undefined ? {} : { environment: options.environment }),
    ...(options.processAdapter === undefined ? {} : { processAdapter: options.processAdapter }),
    start: async ({ config, health, markReady, readiness, registerResource }) => {
      const environment = options.environment ?? process.env
      const dataDirectory =
        options.compositionOptions?.dataDirectory ??
        environment['CONTROL_PLANE_DATA_DIR'] ??
        join(homedir(), '.control-plane-hosted')
      const restateAdminUrl =
        options.compositionOptions?.restateAdminUrl ?? environment['RESTATE_ADMIN_URL']
      const restateIngressUrl =
        options.compositionOptions?.restateIngressUrl ?? environment['RESTATE_INGRESS_URL']
      const workflowDeploymentUri =
        options.compositionOptions?.workflowDeploymentUri ?? environment['WORKFLOW_DEPLOYMENT_URI']
      const composition =
        options.composition ??
        new HostedServerControlPlaneComposition({
          dataDirectory,
          databaseUrl:
            options.compositionOptions?.databaseUrl ??
            requiredEnvironment(environment, 'DATABASE_URL'),
          ...(restateAdminUrl === undefined ? {} : { restateAdminUrl }),
          ...(restateIngressUrl === undefined ? {} : { restateIngressUrl }),
          ...(workflowDeploymentUri === undefined ? {} : { workflowDeploymentUri }),
          ...(options.compositionOptions?.workflowEndpointPort === undefined
            ? {}
            : { workflowEndpointPort: options.compositionOptions.workflowEndpointPort }),
        })
      registerResource('hosted-control-plane-composition', () => composition.close())
      await composition.start()
      const authentication = await createPrivateApiAuthentication(dataDirectory)
      const application = await createControlApiApplication({
        executionAcceptanceService: composition.executionAcceptanceService,
        executionValidationService: composition.executionValidationService,
        serviceAuthenticator: authentication.authenticator,
        componentManifest: () => composition.manifest(),
        health,
        logger: options.logger ?? jsonLogger,
        metadata: config.metadata,
        readiness,
      })
      registerResource('hosted-control-plane-api', () => application.close())
      await application.listen({
        host: resolveHostedApiHost(options.apiHost),
        port: config.values.port,
      })
      markReady()
    },
  })

export function resolveHostedApiHost(explicitHost?: string): string {
  const host = explicitHost ?? process.env['CONTROL_PLANE_BIND_HOST'] ?? '127.0.0.1'
  if (!['127.0.0.1', '::1', '0.0.0.0', '::'].includes(host)) {
    throw new Error('HOSTED_CONTROL_PLANE_BIND_HOST_INVALID')
  }
  return host
}

function requiredEnvironment(environment: RawEnvironment, name: string): string {
  const value = environment[name]
  if (value === undefined || value === '') throw new Error(`HOSTED_CONFIGURATION_MISSING_${name}`)
  return value
}

export * from './composition.js'

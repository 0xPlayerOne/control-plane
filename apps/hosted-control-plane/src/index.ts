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
import { createS3CompatibleObjectStore } from '@control-plane/object-store'
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
      const objectStoreConfiguration = resolveHostedObjectStore(
        environment,
        options.compositionOptions
      )
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
          ...objectStoreConfiguration,
          ...(options.compositionOptions?.endpointFactory === undefined
            ? {}
            : { endpointFactory: options.compositionOptions.endpointFactory }),
          ...(options.compositionOptions?.connection === undefined
            ? {}
            : { connection: options.compositionOptions.connection }),
          ...(options.compositionOptions?.secrets === undefined
            ? {}
            : { secrets: options.compositionOptions.secrets }),
          ...(options.compositionOptions?.workflowRuntime === undefined
            ? {}
            : { workflowRuntime: options.compositionOptions.workflowRuntime }),
          ...(options.compositionOptions?.remoteControl === undefined
            ? {}
            : { remoteControl: options.compositionOptions.remoteControl }),
          ...(options.compositionOptions?.remoteControlFactory === undefined
            ? {}
            : { remoteControlFactory: options.compositionOptions.remoteControlFactory }),
        })
      registerResource('hosted-control-plane-composition', () => composition.close())
      await composition.start()
      const authentication = await createPrivateApiAuthentication(dataDirectory)
      const application = await createControlApiApplication({
        executionAcceptanceService: composition.executionAcceptanceService,
        executionValidationService: composition.executionValidationService,
        profileResolutionService: composition.profileResolutionService,
        serviceAuthenticator: authentication.authenticator,
        componentManifest: () => composition.manifest(),
        dependencyReadiness: async () =>
          (await composition.manifest()).components.every((component) => component.ready),
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

export function resolveHostedObjectStore(
  environment: RawEnvironment,
  options: Partial<HostedServerCompositionOptions> | undefined
): Partial<Pick<HostedServerCompositionOptions, 'objectStore' | 'objectStoreKind'>> {
  if (options?.objectStore !== undefined) {
    return {
      objectStore: options.objectStore,
      objectStoreKind: options.objectStoreKind ?? 'filesystem',
    }
  }
  const kind = options?.objectStoreKind ?? environment['HOSTED_OBJECT_STORE'] ?? 'filesystem'
  if (kind === 'filesystem') return {}
  if (kind !== 's3-compatible') throw new Error('HOSTED_OBJECT_STORE_KIND_INVALID')
  const endpoint = requiredEnvironment(environment, 'S3_ENDPOINT')
  if (!validS3Endpoint(endpoint)) throw new Error('HOSTED_OBJECT_STORE_ENDPOINT_INVALID')
  return {
    objectStoreKind: 's3-compatible' as const,
    objectStore: createS3CompatibleObjectStore(
      {
        endpoint,
        bucket: requiredEnvironment(environment, 'S3_BUCKET'),
        region: requiredEnvironment(environment, 'S3_REGION'),
        accessKeyId: requiredEnvironment(environment, 'S3_ACCESS_KEY_ID'),
        secretAccessKey: requiredEnvironment(environment, 'S3_SECRET_ACCESS_KEY'),
      },
      { maxObjectBytes: 64 * 1024 * 1024 }
    ),
  }
}

function validS3Endpoint(value: string): boolean {
  try {
    const endpoint = new URL(value)
    return (
      endpoint.protocol === 'https:' &&
      endpoint.username === '' &&
      endpoint.password === '' &&
      endpoint.search === '' &&
      endpoint.hash === ''
    )
  } catch {
    return false
  }
}

export * from './composition.js'

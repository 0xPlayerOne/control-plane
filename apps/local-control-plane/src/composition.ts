import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type {
  DeploymentComponentHealth,
  ObjectStore,
  ProcessRuntimeProvider,
  SecretsProvider,
  WorkflowRuntime,
} from '@control-plane/deployment'
import {
  BufferedObservabilityProvider,
  LocalCoordinationProvider,
  NodeProcessRuntimeProvider,
  StaticServiceDiscovery,
} from '@control-plane/deployment'
import { FilesystemObjectStore } from '@control-plane/object-store'
import { LocalRestateRuntime, RESTATE_SERVER_VERSION } from '@control-plane/restate-runtime'
import type { RuntimeTransport } from '@control-plane/runtime-sdk'
import {
  CompositeSecretsProvider,
  EnvironmentSecretsProvider,
  PrivateFileSecretsProvider,
} from '@control-plane/secrets'
import {
  SqliteExecutionPlanRepository,
  SqlitePersistenceProvider,
} from '@control-plane/sqlite-persistence'
import {
  createRestateEndpointFactory,
  type ExecutionLifecycleActivities,
  type RestateEndpointFactory,
  type RestateEndpointHandle,
} from '@control-plane/workflow-runtime'
import { DirectRuntimeExecutionActivities } from './direct-runtime-activities.js'

const require = createRequire(import.meta.url)
const COMPONENT_VERSION = '1.0.0'
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024

export interface LocalComponentManifest {
  readonly schemaVersion: 1
  readonly profile: 'local'
  readonly version: string
  readonly dataDirectory: string
  readonly components: readonly DeploymentComponentHealth[]
  readonly topology: {
    readonly externalServices: 0
    readonly runtimeTransport: 'direct-local' | 'unconfigured'
    readonly restateVersion: string
    readonly persistence: 'sqlite'
    readonly objectStore: 'filesystem'
  }
}

export interface LocalControlPlaneCompositionOptions {
  readonly dataDirectory: string
  readonly workflowEndpointPort?: number
  readonly processProvider?: ProcessRuntimeProvider
  readonly workflowRuntime?: WorkflowRuntime
  readonly endpointFactory?: RestateEndpointFactory
  readonly activities?: ExecutionLifecycleActivities
  readonly runtimeTransport?: RuntimeTransport
  readonly secrets?: SecretsProvider
  readonly environmentSecretReferences?: Readonly<Record<string, string>>
  readonly environment?: Readonly<Record<string, string | undefined>>
}

export class LocalControlPlaneComposition {
  readonly dataDirectory: string
  readonly persistence: SqlitePersistenceProvider
  readonly objectStore: ObjectStore
  readonly workflow: WorkflowRuntime
  readonly secrets: SecretsProvider
  readonly runtimeTransport: RuntimeTransport | undefined
  readonly coordination = new LocalCoordinationProvider()
  readonly observability = new BufferedObservabilityProvider()
  readonly discovery: StaticServiceDiscovery
  readonly #endpointFactory: RestateEndpointFactory
  #endpoint: RestateEndpointHandle | undefined
  #started = false

  constructor(options: LocalControlPlaneCompositionOptions) {
    this.dataDirectory = resolve(options.dataDirectory)
    const processProvider = options.processProvider ?? new NodeProcessRuntimeProvider()
    const workflowEndpointPort = options.workflowEndpointPort ?? 9080
    this.persistence = new SqlitePersistenceProvider({
      path: join(this.dataDirectory, 'control-plane.sqlite'),
    })
    this.objectStore = new FilesystemObjectStore({
      rootDirectory: join(this.dataDirectory, 'artifacts'),
      maxObjectBytes: MAX_ARTIFACT_BYTES,
    })
    this.secrets =
      options.secrets ??
      new CompositeSecretsProvider({
        env: new EnvironmentSecretsProvider({
          references: options.environmentSecretReferences ?? {},
          ...(options.environment === undefined ? {} : { environment: options.environment }),
        }),
        file: new PrivateFileSecretsProvider({
          rootDirectory: join(this.dataDirectory, 'secrets'),
        }),
      })
    if (options.runtimeTransport?.kind === 'remote-gateway') {
      throw new Error('LOCAL_RUNTIME_TRANSPORT_MUST_BE_DIRECT')
    }
    this.runtimeTransport = options.runtimeTransport
    const activities =
      options.activities ??
      (options.runtimeTransport === undefined
        ? undefined
        : new DirectRuntimeExecutionActivities(
            this.persistence,
            this.objectStore,
            options.runtimeTransport,
            new SqliteExecutionPlanRepository(this.persistence)
          ))
    this.#endpointFactory =
      options.endpointFactory ??
      createRestateEndpointFactory({
        host: '127.0.0.1',
        port: workflowEndpointPort,
        ...(activities === undefined ? {} : { activities }),
      })
    this.workflow =
      options.workflowRuntime ??
      new LocalRestateRuntime({
        executablePath: join(
          resolve(require.resolve('@restatedev/restate-server/package.json'), '..'),
          'lib',
          'index.js'
        ),
        dataDirectory: join(this.dataDirectory, 'restate'),
        processProvider,
        deploymentUri: `http://127.0.0.1:${workflowEndpointPort}`,
      })
    this.discovery = new StaticServiceDiscovery([
      { service: 'restate', url: new URL('http://127.0.0.1:8080'), private: true },
      {
        service: 'workflow-runtime',
        url: new URL(`http://127.0.0.1:${workflowEndpointPort}`),
        private: true,
      },
    ])
  }

  async start(): Promise<void> {
    if (this.#started) throw new Error('LOCAL_CONTROL_PLANE_ALREADY_STARTED')
    await mkdir(this.dataDirectory, { recursive: true, mode: 0o700 })
    await this.persistence.migrate()
    this.#endpoint = await this.#endpointFactory.create()
    await this.#endpoint.run()
    try {
      await this.workflow.start()
    } catch (error) {
      await this.#endpoint.shutdown().catch(() => undefined)
      this.#endpoint = undefined
      throw error
    }
    this.#started = true
    this.observability.record({
      name: 'local-started',
      occurredAt: new Date().toISOString(),
      attributes: { profile: 'local' },
    })
  }

  async manifest(): Promise<LocalComponentManifest> {
    const components = await Promise.all([
      this.persistence.health(),
      this.workflow.health(),
      this.secrets.health(),
      this.observability.health(),
    ])
    return {
      schemaVersion: 1,
      profile: 'local',
      version: COMPONENT_VERSION,
      dataDirectory: this.dataDirectory,
      components,
      topology: {
        externalServices: 0,
        runtimeTransport: this.runtimeTransport === undefined ? 'unconfigured' : 'direct-local',
        restateVersion: RESTATE_SERVER_VERSION,
        persistence: 'sqlite',
        objectStore: 'filesystem',
      },
    }
  }

  async close(): Promise<void> {
    if (!this.#started && this.#endpoint === undefined) return
    this.#started = false
    await this.workflow.stop().catch(() => undefined)
    await this.#endpoint?.shutdown().catch(() => undefined)
    this.#endpoint = undefined
    await this.secrets.close()
    await this.objectStore.close()
    this.persistence.close()
    this.coordination.close()
    this.observability.close()
  }
}

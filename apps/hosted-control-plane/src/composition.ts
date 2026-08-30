import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  DurableExecutionAcceptanceService,
  DurableExecutionValidationService,
  RestateExecutionWorkflowDispatcher,
  createExecutionId,
} from '@control-plane/control-api'
import {
  createPostgresConnection,
  PostgresCatalogRepository,
  PostgresCommandAcceptanceRepository,
  PostgresContextPackageRepository,
  PostgresExecutionPlanRepository,
  PostgresExecutionRepository,
  PostgresProjectStateRepository,
  type PostgresConnection,
} from '@control-plane/database'
import type {
  DeploymentComponentHealth,
  ObjectStore,
  SecretsProvider,
  WorkflowRuntime,
} from '@control-plane/deployment'
import {
  BufferedObservabilityProvider,
  LocalCoordinationProvider,
  NodeProcessRuntimeProvider,
  StaticServiceDiscovery,
} from '@control-plane/deployment'
import { CommandInboxService, ExecutionLifecycleService } from '@control-plane/domain'
import { ExecutionPlanAcceptanceValidator } from '@control-plane/execution-plan'
import { FilesystemObjectStore } from '@control-plane/object-store'
import { RemoteRestateRuntime, RESTATE_SERVER_VERSION } from '@control-plane/restate-runtime'
import type {
  ExecutionAcceptancePort,
  RemoteControlHostAdapter,
} from '@control-plane/remote-control-relay'
import {
  CompositeSecretsProvider,
  EnvironmentSecretsProvider,
  PrivateFileSecretsProvider,
} from '@control-plane/secrets'
import {
  createRestateEndpointFactory,
  type RestateEndpointFactory,
  type RestateEndpointHandle,
  type WorkflowRuntimeOutcome,
} from '@control-plane/workflow-runtime'
import {
  DisabledGraphSegmentActivities,
  DurableExecutionLifecycleActivities,
  type WorkflowRuntimeActivityPort,
} from '@control-plane/workflow-worker'

const COMPONENT_VERSION = '1.0.0'
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024

export interface HostedServerManifest {
  readonly schemaVersion: 1
  readonly profile: 'hosted-server'
  readonly version: string
  readonly dataDirectory: string
  readonly components: readonly DeploymentComponentHealth[]
  readonly topology: {
    readonly externalServices: 2
    readonly runtimeTransport: 'unconfigured'
    readonly restateVersion: string
    readonly persistence: 'postgresql'
    readonly objectStore: 'filesystem'
    readonly remoteControl: 'disabled' | 'outbound'
  }
}

export interface HostedServerCompositionOptions {
  readonly dataDirectory: string
  readonly databaseUrl: string
  readonly restateAdminUrl?: string
  readonly restateIngressUrl?: string
  readonly workflowDeploymentUri?: string
  readonly workflowEndpointPort?: number
  readonly endpointFactory?: RestateEndpointFactory
  readonly connection?: PostgresConnection
  readonly secrets?: SecretsProvider
  readonly workflowRuntime?: WorkflowRuntime
  readonly remoteControl?: RemoteControlHostAdapter<unknown>
  readonly remoteControlFactory?: (
    acceptance: ExecutionAcceptancePort
  ) => RemoteControlHostAdapter<unknown>
}

export class HostedServerControlPlaneComposition {
  readonly dataDirectory: string
  readonly connection: PostgresConnection
  readonly objectStore: ObjectStore
  readonly secrets: SecretsProvider
  readonly workflow: WorkflowRuntime
  readonly remoteControl: RemoteControlHostAdapter<unknown> | undefined
  readonly coordination = new LocalCoordinationProvider()
  readonly processes = new NodeProcessRuntimeProvider()
  readonly observability = new BufferedObservabilityProvider()
  readonly discovery: StaticServiceDiscovery
  readonly executionAcceptanceService: DurableExecutionAcceptanceService
  readonly executionValidationService: DurableExecutionValidationService
  readonly #endpointFactory: RestateEndpointFactory
  #endpoint: RestateEndpointHandle | undefined
  #started = false

  constructor(options: HostedServerCompositionOptions) {
    this.dataDirectory = resolve(options.dataDirectory)
    this.connection =
      options.connection ??
      createPostgresConnection(
        { role: 'application', url: options.databaseUrl },
        { maxConnections: 10 }
      )
    this.objectStore = new FilesystemObjectStore({
      rootDirectory: join(this.dataDirectory, 'artifacts'),
      maxObjectBytes: MAX_ARTIFACT_BYTES,
    })
    this.secrets =
      options.secrets ??
      new CompositeSecretsProvider({
        env: new EnvironmentSecretsProvider({ references: {} }),
        file: new PrivateFileSecretsProvider({
          rootDirectory: join(this.dataDirectory, 'secrets'),
        }),
      })
    const restateIngressUrl = options.restateIngressUrl ?? 'http://restate:8080'
    const plans = new PostgresExecutionPlanRepository(this.connection.database)
    const catalog = new PostgresCatalogRepository(this.connection.database)
    this.executionAcceptanceService = new DurableExecutionAcceptanceService({
      commands: new CommandInboxService({
        repository: new PostgresCommandAcceptanceRepository(this.connection.database),
        executionIdFactory: createExecutionId,
        executionPlanValidator: new ExecutionPlanAcceptanceValidator(plans),
      }),
      dispatcher: new RestateExecutionWorkflowDispatcher({ ingressUrl: restateIngressUrl }),
    })
    if (options.remoteControl !== undefined && options.remoteControlFactory !== undefined) {
      throw new Error('HOSTED_REMOTE_CONTROL_CONFIGURATION_CONFLICT')
    }
    this.remoteControl =
      options.remoteControl ?? options.remoteControlFactory?.(this.executionAcceptanceService)
    this.executionValidationService = new DurableExecutionValidationService({
      compilerVersion: COMPONENT_VERSION,
      contextPackages: new PostgresContextPackageRepository(this.connection.database),
      plans,
      profiles: catalog,
      projectStates: new PostgresProjectStateRepository(this.connection.database),
      skills: catalog,
    })

    const activities = new DurableExecutionLifecycleActivities({
      lifecycle: new ExecutionLifecycleService(
        new PostgresExecutionRepository(this.connection.database)
      ),
      plans,
      runtime: new UnconfiguredHostedRuntime(),
      graph: new DisabledGraphSegmentActivities(),
      commands: new CommandInboxService({
        repository: new PostgresCommandAcceptanceRepository(this.connection.database),
        executionIdFactory: unavailableExecutionIdFactory,
        executionPlanValidator: new ExecutionPlanAcceptanceValidator(plans),
      }),
    })
    const workflowEndpointPort = options.workflowEndpointPort ?? 9080
    this.#endpointFactory =
      options.endpointFactory ??
      createRestateEndpointFactory({ host: '0.0.0.0', port: workflowEndpointPort, activities })
    this.workflow =
      options.workflowRuntime ??
      new RemoteRestateRuntime({
        profile: 'hosted-server',
        adminUrl: options.restateAdminUrl ?? 'http://restate:9070',
        ingressUrl: restateIngressUrl,
        deploymentUri:
          options.workflowDeploymentUri ?? `http://control-plane-server:${workflowEndpointPort}`,
      })
    this.discovery = new StaticServiceDiscovery([
      { service: 'postgresql', url: databaseServiceUrl(options.databaseUrl), private: true },
      { service: 'restate', url: new URL(restateIngressUrl), private: true },
      {
        service: 'workflow-runtime',
        url: new URL(
          options.workflowDeploymentUri ?? `http://control-plane-server:${workflowEndpointPort}`
        ),
        private: true,
      },
    ])
  }

  async start(): Promise<void> {
    if (this.#started) throw new Error('HOSTED_CONTROL_PLANE_ALREADY_STARTED')
    await mkdir(this.dataDirectory, { recursive: true, mode: 0o700 })
    await this.connection.check()
    this.#endpoint = await this.#endpointFactory.create()
    await this.#endpoint.run()
    try {
      await this.workflow.start()
      await this.remoteControl?.start()
    } catch (error) {
      this.remoteControl?.stop()
      await this.workflow.stop().catch(() => undefined)
      await this.#endpoint.shutdown().catch(() => undefined)
      this.#endpoint = undefined
      throw error
    }
    this.#started = true
    this.observability.record({
      name: 'hosted-server-started',
      occurredAt: new Date().toISOString(),
      attributes: { profile: 'hosted-server' },
    })
  }

  async manifest(): Promise<HostedServerManifest> {
    let databaseReady = true
    try {
      await this.connection.check()
    } catch {
      databaseReady = false
    }
    const components = await Promise.all([
      Promise.resolve({
        ready: databaseReady,
        component: 'postgresql-persistence',
        version: '18',
        details: { profile: 'hosted-server' },
      }),
      this.workflow.health(),
      this.secrets.health(),
      this.observability.health(),
      ...(this.remoteControl === undefined ? [] : [this.remoteControl.health()]),
    ])
    return {
      schemaVersion: 1,
      profile: 'hosted-server',
      version: COMPONENT_VERSION,
      dataDirectory: this.dataDirectory,
      components,
      topology: {
        externalServices: 2,
        runtimeTransport: 'unconfigured',
        restateVersion: RESTATE_SERVER_VERSION,
        persistence: 'postgresql',
        objectStore: 'filesystem',
        remoteControl: this.remoteControl === undefined ? 'disabled' : 'outbound',
      },
    }
  }

  async close(): Promise<void> {
    this.#started = false
    this.remoteControl?.stop()
    await this.workflow.stop().catch(() => undefined)
    await this.#endpoint?.shutdown().catch(() => undefined)
    this.#endpoint = undefined
    await this.secrets.close()
    await this.objectStore.close()
    await this.connection.close()
    this.coordination.close()
    this.observability.close()
  }
}

class UnconfiguredHostedRuntime implements WorkflowRuntimeActivityPort {
  dispatch(): Promise<WorkflowRuntimeOutcome> {
    return Promise.resolve({
      outcome: 'failed',
      failureCode: 'HOSTED_RUNTIME_NOT_CONFIGURED',
      retryable: false,
    })
  }

  applyInteraction(): Promise<WorkflowRuntimeOutcome> {
    return this.dispatch()
  }

  cleanup(): Promise<void> {
    return Promise.resolve()
  }
}

function unavailableExecutionIdFactory(): never {
  throw new Error('WORKFLOW_ENDPOINT_CANNOT_ACCEPT_EXECUTIONS')
}

function databaseServiceUrl(value: string): URL {
  const url = new URL(value)
  url.username = ''
  url.password = ''
  url.search = ''
  return url
}

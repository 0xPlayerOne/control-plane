import type {
  ExternalSessionDiscoveryReadModel,
  RuntimeConnectionDiscoveryReadModel,
} from '@control-plane/contracts'

export const RUNTIME_DISCOVERY_REPOSITORY = Symbol('RUNTIME_DISCOVERY_REPOSITORY')

export interface RuntimeDiscoveryScope {
  readonly workspaceId: string
  readonly projectId?: string
  readonly runtimeNodeRefId?: string
}

export interface RuntimeDiscoveryRepository {
  listRuntimeConnections(scope: RuntimeDiscoveryScope): Promise<readonly unknown[]>
  getRuntimeConnection(
    scope: RuntimeDiscoveryScope,
    runtimeConnectionId: string
  ): Promise<unknown | undefined>
  listExternalSessions(scope: RuntimeDiscoveryScope): Promise<readonly unknown[]>
  getExternalSession(
    scope: RuntimeDiscoveryScope,
    externalSessionId: string
  ): Promise<unknown | undefined>
}

export class EmptyRuntimeDiscoveryRepository implements RuntimeDiscoveryRepository {
  async listRuntimeConnections(): Promise<readonly never[]> {
    return []
  }

  async getRuntimeConnection(): Promise<undefined> {
    return undefined
  }

  async listExternalSessions(): Promise<readonly never[]> {
    return []
  }

  async getExternalSession(): Promise<undefined> {
    return undefined
  }
}

interface ScopedRuntimeConnection {
  readonly workspaceId: string
  readonly model: RuntimeConnectionDiscoveryReadModel | Record<string, unknown>
}

interface ScopedExternalSession {
  readonly workspaceId: string
  readonly projectId?: string
  readonly runtimeNodeRefId?: string
  readonly model: ExternalSessionDiscoveryReadModel | Record<string, unknown>
}

export class InMemoryRuntimeDiscoveryRepository implements RuntimeDiscoveryRepository {
  constructor(
    readonly runtimeConnections: readonly ScopedRuntimeConnection[],
    readonly externalSessions: readonly ScopedExternalSession[]
  ) {}

  async listRuntimeConnections(scope: RuntimeDiscoveryScope): Promise<readonly unknown[]> {
    return this.runtimeConnections
      .filter(
        (entry) =>
          entry.workspaceId === scope.workspaceId &&
          (scope.runtimeNodeRefId === undefined ||
            runtimeNodeRefId(entry.model) === scope.runtimeNodeRefId)
      )
      .map((entry) => structuredClone(entry.model))
  }

  async getRuntimeConnection(
    scope: RuntimeDiscoveryScope,
    runtimeConnectionId: string
  ): Promise<unknown | undefined> {
    return structuredClone(
      this.runtimeConnections.find(
        (entry) =>
          entry.workspaceId === scope.workspaceId &&
          Reflect.get(entry.model, 'runtimeConnectionId') === runtimeConnectionId &&
          (scope.runtimeNodeRefId === undefined ||
            runtimeNodeRefId(entry.model) === scope.runtimeNodeRefId)
      )?.model
    )
  }

  async listExternalSessions(scope: RuntimeDiscoveryScope): Promise<readonly unknown[]> {
    return this.externalSessions
      .filter(
        (entry) =>
          entry.workspaceId === scope.workspaceId &&
          (scope.projectId === undefined || entry.projectId === scope.projectId) &&
          (scope.runtimeNodeRefId === undefined ||
            entry.runtimeNodeRefId === scope.runtimeNodeRefId)
      )
      .map((entry) => structuredClone(entry.model))
  }

  async getExternalSession(
    scope: RuntimeDiscoveryScope,
    externalSessionId: string
  ): Promise<unknown | undefined> {
    return structuredClone(
      this.externalSessions.find(
        (entry) =>
          entry.workspaceId === scope.workspaceId &&
          (scope.projectId === undefined || entry.projectId === scope.projectId) &&
          (scope.runtimeNodeRefId === undefined ||
            entry.runtimeNodeRefId === scope.runtimeNodeRefId) &&
          Reflect.get(entry.model, 'externalSessionId') === externalSessionId
      )?.model
    )
  }
}

function runtimeNodeRefId(model: object): unknown {
  const node = Reflect.get(model, 'node')
  return typeof node === 'object' && node !== null
    ? Reflect.get(node, 'runtimeNodeRefId')
    : undefined
}

import {
  GatewayInventoryEnvelopeSchema,
  GatewayProtocolManifest,
  type GatewayInventoryEnvelope,
} from '@control-plane/runtime-gateway-protocol'
import {
  RuntimeConnectionRegistrationSchema,
  RuntimeHealthReportSchema,
  RuntimeInventoryCheckpointSchema,
  projectRuntimeConnectionDiscovery,
  type RuntimeAvailabilityChangePublisher,
  type RuntimeConnection,
  type RuntimeConnectionRegistration,
  type RuntimeHealthIngestionService,
  type RuntimeHealthReport,
  type RuntimeInventoryCheckpointRepository,
  type RuntimeConnectionRegistry,
} from '@control-plane/runtime-sdk'
import { createHash } from 'node:crypto'
import type { ActiveRuntimeNodeChannelRecord, GatewayMetrics } from './websocket-coordination.js'

type InventoryDriver = GatewayInventoryEnvelope['runtimeDrivers'][number]

export interface NormalizedRuntimeInventoryEntry {
  readonly registration: RuntimeConnectionRegistration
  readonly healthReport: RuntimeHealthReport
}

export interface RuntimeInventoryNormalizer {
  normalize(input: {
    readonly driver: InventoryDriver
    readonly inventory: GatewayInventoryEnvelope
    readonly nodeStatus: 'online' | 'offline' | 'unknown' | 'revoked'
  }): Promise<NormalizedRuntimeInventoryEntry>
}

export interface RuntimeDiscoveryProjectionWriter {
  putRuntimeConnection(
    workspaceId: string,
    model: ReturnType<typeof projectRuntimeConnectionDiscovery>
  ): Promise<void>
}

export interface RuntimeInventoryIngestionOptions {
  readonly registry: RuntimeConnectionRegistry
  readonly health: RuntimeHealthIngestionService
  readonly checkpoints: RuntimeInventoryCheckpointRepository
  readonly changes: RuntimeAvailabilityChangePublisher
  readonly normalizer: RuntimeInventoryNormalizer
  readonly metrics: GatewayMetrics
  readonly projections: RuntimeDiscoveryProjectionWriter
  readonly disappearanceTtlMs?: number
}

export interface RuntimeInventoryIngestionResult {
  readonly outcome: 'applied' | 'duplicate' | 'stale'
  readonly snapshotVersion: number
  readonly updated: readonly RuntimeConnection[]
  readonly disappeared: readonly RuntimeConnection[]
}

export type RuntimeInventoryIngestionErrorCode =
  | 'INVENTORY_SCOPE_MISMATCH'
  | 'INVENTORY_PROTOCOL_UNSUPPORTED'
  | 'INVENTORY_VERSION_CONFLICT'
  | 'INVENTORY_DELTA_BASE_MISMATCH'
  | 'INVENTORY_NORMALIZATION_FAILED'
  | 'INVENTORY_CORRELATION_MISMATCH'
  | 'INVENTORY_CHECKPOINT_CONFLICT'

export class RuntimeInventoryIngestionError extends Error {
  constructor(readonly code: RuntimeInventoryIngestionErrorCode) {
    super(code)
    this.name = 'RuntimeInventoryIngestionError'
  }
}

export class RuntimeInventoryIngestionService {
  readonly #changes: RuntimeAvailabilityChangePublisher
  readonly #checkpoints: RuntimeInventoryCheckpointRepository
  readonly #health: RuntimeHealthIngestionService
  readonly #disappearanceTtlMs: number
  readonly #metrics: GatewayMetrics
  readonly #normalizer: RuntimeInventoryNormalizer
  readonly #projections: RuntimeDiscoveryProjectionWriter
  readonly #registry: RuntimeConnectionRegistry

  constructor(options: RuntimeInventoryIngestionOptions) {
    this.#registry = options.registry
    this.#health = options.health
    this.#checkpoints = options.checkpoints
    this.#changes = options.changes
    this.#normalizer = options.normalizer
    this.#projections = options.projections
    this.#metrics = options.metrics
    this.#disappearanceTtlMs = options.disappearanceTtlMs ?? 300_000
    if (!Number.isSafeInteger(this.#disappearanceTtlMs) || this.#disappearanceTtlMs <= 0) {
      throw new Error('Invalid disappearanceTtlMs')
    }
  }

  async expireDisappeared(
    runtimeNodeRefId: string,
    evaluatedAt: string
  ): Promise<readonly RuntimeConnection[]> {
    const connections = await this.#registry.listByRuntimeNode(runtimeNodeRefId)
    const expired: RuntimeConnection[] = []
    for (const connection of connections) {
      if (
        connection.status !== 'unavailable' ||
        !connection.diagnostics?.includes('RUNTIME_DISAPPEARED') ||
        connection.expiresAt === undefined ||
        Date.parse(connection.expiresAt) > Date.parse(evaluatedAt)
      ) {
        continue
      }
      expired.push(
        await this.#registry.expire({
          runtimeConnectionId: connection.runtimeConnectionId,
          expectedVersion: connection.version,
          observedAt: evaluatedAt,
        })
      )
    }
    if (expired.length > 0) {
      this.#metrics.increment('runtime_gateway.inventory_expired', {
        count: String(expired.length),
      })
    }
    return expired
  }

  async ingest(
    inventoryValue: unknown,
    source: ActiveRuntimeNodeChannelRecord,
    nodeStatus: 'online' | 'offline' | 'unknown' | 'revoked' = 'online'
  ): Promise<RuntimeInventoryIngestionResult> {
    const inventory = GatewayInventoryEnvelopeSchema.parse(inventoryValue)
    this.#assertSource(inventory, source)
    const digest = hashInventory(inventory)
    const current = await this.#checkpoints.get(inventory.nodeId)
    if (current?.workspaceId !== undefined && current.workspaceId !== inventory.workspaceId) {
      fail('INVENTORY_SCOPE_MISMATCH')
    }
    if (current && inventory.snapshotVersion < current.snapshotVersion) {
      return this.#ignored('stale', inventory.snapshotVersion)
    }
    if (current && inventory.snapshotVersion === current.snapshotVersion) {
      if (current.snapshotDigest !== digest) fail('INVENTORY_VERSION_CONFLICT')
      return this.#ignored('duplicate', inventory.snapshotVersion)
    }
    const mode = inventory.mode ?? 'snapshot'
    if (mode === 'delta' && current?.snapshotVersion !== inventory.baseSnapshotVersion) {
      fail('INVENTORY_DELTA_BASE_MISMATCH')
    }

    const normalized = await Promise.all(
      inventory.runtimeDrivers.map(async (driver) => {
        try {
          const entry = await this.#normalizer.normalize({ driver, inventory, nodeStatus })
          return this.#validateCorrelation(entry, driver, inventory, nodeStatus)
        } catch (error) {
          if (error instanceof RuntimeInventoryIngestionError) throw error
          fail('INVENTORY_NORMALIZATION_FAILED')
        }
      })
    )
    const connectionIds = normalized.map(({ registration }) => registration.runtimeConnectionId)
    const identityDigests = normalized.map(({ registration }) => registration.identityDigest)
    if (
      new Set(connectionIds).size !== connectionIds.length ||
      new Set(identityDigests).size !== identityDigests.length
    ) {
      fail('INVENTORY_CORRELATION_MISMATCH')
    }
    const updated: RuntimeConnection[] = []
    for (const [index, entry] of normalized.entries()) {
      await this.#registry.register(entry.registration)
      const result = await this.#health.ingest(entry.healthReport, inventory.observedAt)
      updated.push(result.connection)
      await this.#projections.putRuntimeConnection(
        inventory.workspaceId,
        projectRuntimeConnectionDiscovery({
          connection: result.connection,
          family: inventory.runtimeDrivers[index]!.driverFamily,
          node: {
            runtimeNodeRefId: inventory.nodeId,
            authority: 'agent_hq',
            displayName: inventory.nodeId,
            location: 'local_device',
            status: publicNodeStatus(nodeStatus),
            observedAt: inventory.observedAt,
          },
          nodeHealth: nodeStatus,
          evaluatedAt: inventory.observedAt,
          localProjectGrant: { required: false, state: 'not_required' },
          entitlement: { state: 'allowed' },
        })
      )
    }

    const previousRefs = new Set(current?.activeRuntimeRefs ?? [])
    const reportedRefs = new Set(inventory.runtimeDrivers.map(({ opaqueRef }) => opaqueRef))
    const removedRefs = new Set(inventory.removedRuntimeRefs ?? [])
    const activeRefs =
      mode === 'snapshot'
        ? reportedRefs
        : new Set(
            [...previousRefs, ...reportedRefs].filter((runtimeRef) => !removedRefs.has(runtimeRef))
          )
    const disappearedRefs =
      mode === 'snapshot'
        ? [...previousRefs].filter((runtimeRef) => !reportedRefs.has(runtimeRef))
        : [...removedRefs]
    const disappeared = await this.#markDisappeared(
      inventory.nodeId,
      new Set(disappearedRefs),
      inventory.observedAt
    )

    const checkpoint = RuntimeInventoryCheckpointSchema.parse({
      runtimeNodeRefId: inventory.nodeId,
      workspaceId: inventory.workspaceId,
      snapshotVersion: inventory.snapshotVersion,
      snapshotDigest: digest,
      observedAt: inventory.observedAt,
      activeRuntimeRefs: [...activeRefs].sort(),
      revision: (current?.revision ?? 0) + 1,
    })
    if (!(await this.#checkpoints.compareAndSet(current?.revision, checkpoint))) {
      const winner = await this.#checkpoints.get(inventory.nodeId)
      if (
        winner?.snapshotVersion === inventory.snapshotVersion &&
        winner.snapshotDigest === digest
      ) {
        return this.#ignored('duplicate', inventory.snapshotVersion)
      }
      fail('INVENTORY_CHECKPOINT_CONFLICT')
    }
    this.#metrics.increment('runtime_gateway.inventory_applied', { mode })
    this.#metrics.setGauge('runtime_gateway.node_runtimes', activeRefs.size, {
      nodeId: inventory.nodeId,
    })
    return {
      outcome: 'applied',
      snapshotVersion: inventory.snapshotVersion,
      updated,
      disappeared,
    }
  }

  #assertSource(inventory: GatewayInventoryEnvelope, source: ActiveRuntimeNodeChannelRecord): void {
    const supported = GatewayProtocolManifest.supported.some(
      (version) =>
        version.major === inventory.protocolVersion.major &&
        version.minor === inventory.protocolVersion.minor
    )
    if (!supported) fail('INVENTORY_PROTOCOL_UNSUPPORTED')
    if (
      inventory.nodeId !== source.nodeId ||
      inventory.workspaceId !== source.workspaceId ||
      inventory.channelGeneration !== source.channelGeneration ||
      inventory.protocolVersion.major !== source.protocolVersion.major ||
      inventory.protocolVersion.minor > source.protocolVersion.minor
    ) {
      fail('INVENTORY_SCOPE_MISMATCH')
    }
  }

  #validateCorrelation(
    entryValue: NormalizedRuntimeInventoryEntry,
    driver: InventoryDriver,
    inventory: GatewayInventoryEnvelope,
    nodeStatus: 'online' | 'offline' | 'unknown' | 'revoked'
  ): NormalizedRuntimeInventoryEntry {
    const registration = RuntimeConnectionRegistrationSchema.parse(entryValue.registration)
    const healthReport = RuntimeHealthReportSchema.parse(entryValue.healthReport)
    const expectedProtocol = `${driver.protocolVersion.major}.${driver.protocolVersion.minor}.0`
    const expectedRuntimeState = driver.health === 'unavailable' ? 'offline' : driver.health
    if (
      registration.runtimeNodeRefId !== inventory.nodeId ||
      registration.location !== 'local_device' ||
      registration.connectionType === 'managed_cloud' ||
      registration.opaqueNativeRef !== driver.opaqueRef ||
      registration.driverVersion !== driver.driverVersion ||
      (driver.adapterVersion !== undefined &&
        registration.adapterVersion !== driver.adapterVersion) ||
      (driver.harnessVersion !== undefined &&
        registration.harnessVersion !== driver.harnessVersion) ||
      healthReport.runtimeConnectionId !== registration.runtimeConnectionId ||
      healthReport.reportSequence !== inventory.snapshotVersion ||
      healthReport.observedAt !== inventory.observedAt ||
      healthReport.discoveredAt !== inventory.observedAt ||
      healthReport.nodeStatus !== nodeStatus ||
      healthReport.runtimeState !== expectedRuntimeState ||
      healthReport.versions.adapter !== registration.adapterVersion ||
      healthReport.versions.driver !== driver.driverVersion ||
      healthReport.versions.harness !== registration.harnessVersion ||
      healthReport.versions.protocol !== expectedProtocol ||
      healthReport.capabilitySnapshot.version !== inventory.snapshotVersion ||
      healthReport.capabilitySnapshot.observedAt !== inventory.observedAt ||
      Date.parse(registration.lastDiscoveredAt) > Date.parse(inventory.observedAt) ||
      Date.parse(registration.lastHeartbeatAt) > Date.parse(inventory.observedAt) ||
      Date.parse(registration.lastHealthCheckAt) > Date.parse(inventory.observedAt)
    ) {
      fail('INVENTORY_CORRELATION_MISMATCH')
    }
    return { registration, healthReport }
  }

  async #markDisappeared(
    runtimeNodeRefId: string,
    disappearedRefs: ReadonlySet<string>,
    observedAt: string
  ): Promise<RuntimeConnection[]> {
    if (disappearedRefs.size === 0) return []
    const connections = await this.#registry.listByRuntimeNode(runtimeNodeRefId)
    const disappeared: RuntimeConnection[] = []
    for (const connection of connections) {
      if (
        connection.opaqueNativeRef === undefined ||
        !disappearedRefs.has(connection.opaqueNativeRef) ||
        connection.status === 'revoked' ||
        Date.parse(connection.updatedAt) > Date.parse(observedAt)
      ) {
        continue
      }
      const next = await this.#registry.update({
        runtimeConnectionId: connection.runtimeConnectionId,
        expectedVersion: connection.version,
        observedAt,
        status: 'unavailable',
        health: 'unavailable',
        availabilityState: 'offline',
        compatibilityState: 'unavailable',
        diagnostics: ['RUNTIME_DISAPPEARED'],
        expiresAt: new Date(Date.parse(observedAt) + this.#disappearanceTtlMs).toISOString(),
      })
      disappeared.push(next)
      if (connection.availabilityState !== 'offline') {
        await this.#changes.publish({
          type: 'runtime.availability_changed',
          runtimeConnectionId: next.runtimeConnectionId,
          nodeStatus: 'online',
          previousState: connection.availabilityState ?? 'unknown',
          currentState: 'offline',
          occurredAt: observedAt,
          diagnostics: ['RUNTIME_DISAPPEARED'],
        })
      }
    }
    return disappeared
  }

  #ignored(
    outcome: 'duplicate' | 'stale',
    snapshotVersion: number
  ): RuntimeInventoryIngestionResult {
    this.#metrics.increment('runtime_gateway.inventory_ignored', { outcome })
    return { outcome, snapshotVersion, updated: [], disappeared: [] }
  }
}

function publicNodeStatus(
  nodeStatus: 'online' | 'offline' | 'unknown' | 'revoked'
): 'online' | 'offline' | 'revoked' {
  return nodeStatus === 'online' || nodeStatus === 'revoked' ? nodeStatus : 'offline'
}

function hashInventory(inventory: GatewayInventoryEnvelope): string {
  const normalizeDrivers = (drivers: GatewayInventoryEnvelope['runtimeDrivers']) =>
    drivers
      .map((driver) => ({
        ...driver,
        capabilities: [...driver.capabilities].sort(),
        limitations: [...driver.limitations].sort(),
      }))
      .sort((left, right) => left.opaqueRef.localeCompare(right.opaqueRef))
  const canonical = {
    ...inventory,
    runtimeDrivers: normalizeDrivers(inventory.runtimeDrivers),
    contextProviders: normalizeDrivers(inventory.contextProviders),
    ...(inventory.removedRuntimeRefs === undefined
      ? {}
      : { removedRuntimeRefs: [...inventory.removedRuntimeRefs].sort() }),
  }
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`
}

function fail(code: RuntimeInventoryIngestionErrorCode): never {
  throw new RuntimeInventoryIngestionError(code)
}

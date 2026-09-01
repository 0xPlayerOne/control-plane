import { createHash } from 'node:crypto'
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import type {
  MarketplacePlugin,
  MarketplaceRegistryService,
  MarketplaceRelease,
} from './registry.js'

export const marketplaceInstallationStates = [
  'pending-authorization',
  'unavailable',
  'rejected-by-policy',
  'installed',
  'superseded',
] as const

export type MarketplaceInstallationState = (typeof marketplaceInstallationStates)[number]

export type MarketplaceWorkspaceIdentity = Readonly<{
  workspaceId: string
  userId: string
}>

export type MarketplaceInstallationRecord = Readonly<{
  installationId: string
  catalogId: string
  workspaceId: string
  userId: string
  pluginId: string
  releaseId: string
  canonicalContentDigest: string
  requestedHarness: string
  requiredConnectors: readonly string[]
  requiredCredentials: readonly string[]
  state: MarketplaceInstallationState
  idempotencyKey: string
  requestDigest: string
  createdAt: string
  updatedAt: string
}>

export interface MarketplaceInstallationRepository {
  findByIdempotency(
    workspaceId: string,
    idempotencyKey: string
  ): Promise<MarketplaceInstallationRecord | undefined>
  listByWorkspace(workspaceId: string): Promise<readonly MarketplaceInstallationRecord[]>
  save(record: MarketplaceInstallationRecord): Promise<MarketplaceInstallationRecord>
}

export interface MarketplaceInstallationAuthority {
  list(workspaceId: string): Promise<readonly MarketplaceInstallationRecord[]>
  install(envelope: MarketplaceInstallEnvelope): Promise<MarketplaceInstallationRecord>
}

export class InMemoryMarketplaceInstallationRepository implements MarketplaceInstallationRepository {
  readonly #records = new Map<string, MarketplaceInstallationRecord>()

  async findByIdempotency(
    workspaceId: string,
    idempotencyKey: string
  ): Promise<MarketplaceInstallationRecord | undefined> {
    return this.#records.get(`${workspaceId}:${idempotencyKey}`)
  }

  async listByWorkspace(workspaceId: string): Promise<readonly MarketplaceInstallationRecord[]> {
    return [...this.#records.values()].filter((record) => record.workspaceId === workspaceId)
  }

  async save(record: MarketplaceInstallationRecord): Promise<MarketplaceInstallationRecord> {
    this.#records.set(`${record.workspaceId}:${record.idempotencyKey}`, record)
    return record
  }
}

export interface MarketplacePolicyAuthorities {
  authorizeWorkspace?(
    input: Readonly<{
      identity: MarketplaceWorkspaceIdentity
      plugin: MarketplacePlugin
      release: MarketplaceRelease
    }>
  ): Promise<boolean>
  authorizeSecurityClassification?(
    input: Readonly<{
      identity: MarketplaceWorkspaceIdentity
      classification: Readonly<Record<string, unknown>>
    }>
  ): Promise<boolean>
  isRevoked?(
    input: Readonly<{ pluginId: string; releaseId: string; canonicalContentDigest: string }>
  ): Promise<boolean>
  isSuperseded?(input: Readonly<{ pluginId: string; releaseId: string }>): Promise<boolean>
  resolveConnectors?(
    input: Readonly<{ identity: MarketplaceWorkspaceIdentity; names: readonly string[] }>
  ): Promise<Readonly<{ available: boolean }>>
  resolveCredentials?(
    input: Readonly<{ identity: MarketplaceWorkspaceIdentity; names: readonly string[] }>
  ): Promise<Readonly<{ available: boolean }>>
}

export type MarketplaceInstallEnvelope = Readonly<{
  workspaceId: string
  payload: Readonly<{
    pluginId: string
    releaseId: string
    canonicalContentDigest: string
    requestedHarness: string
    workspaceIdentity: MarketplaceWorkspaceIdentity
  }>
  idempotencyKey: string
}>

@Injectable()
export class MarketplaceInstallationService {
  readonly #registry: MarketplaceRegistryService
  readonly #repository: MarketplaceInstallationRepository
  readonly #policy: MarketplacePolicyAuthorities
  readonly #now: () => string

  constructor(
    options: Readonly<{
      registry: MarketplaceRegistryService
      repository: MarketplaceInstallationRepository
      policy?: MarketplacePolicyAuthorities
      now?: () => string
    }>
  ) {
    this.#registry = options.registry
    this.#repository = options.repository
    this.#policy = options.policy ?? {}
    this.#now = options.now ?? (() => new Date().toISOString())
  }

  async list(workspaceId: string): Promise<readonly MarketplaceInstallationRecord[]> {
    return this.#repository.listByWorkspace(workspaceId)
  }

  async install(envelope: MarketplaceInstallEnvelope): Promise<MarketplaceInstallationRecord> {
    const request = parseEnvelope(envelope)
    const requestDigest = digest({
      canonicalContentDigest: request.payload.canonicalContentDigest,
      pluginId: request.payload.pluginId,
      releaseId: request.payload.releaseId,
      requestedHarness: request.payload.requestedHarness,
      workspaceIdentity: request.payload.workspaceIdentity,
    })
    const workspaceId = request.payload.workspaceIdentity.workspaceId
    const existing = await this.#repository.findByIdempotency(workspaceId, request.idempotencyKey)
    if (existing) {
      if (existing.requestDigest !== requestDigest)
        throw new ConflictException({
          code: 'MARKETPLACE_IDEMPOTENCY_CONFLICT',
          message: 'The idempotency key was already used for another marketplace request',
        })
      return existing
    }
    const snapshot = await this.#registry.getCatalog()
    const plugin = snapshot.catalog.plugins.find(
      (candidate) => candidate.pluginId === request.payload.pluginId
    )
    const release = plugin?.availableReleases.find(
      (candidate) => candidate.releaseId === request.payload.releaseId
    )
    let state: MarketplaceInstallationState = 'unavailable'
    if (plugin && release)
      state = await this.#stateFor(
        request.payload.workspaceIdentity,
        plugin,
        release,
        request.payload
      )
    const now = this.#now()
    const record: MarketplaceInstallationRecord = {
      canonicalContentDigest: request.payload.canonicalContentDigest,
      catalogId: snapshot.catalogId,
      createdAt: now,
      idempotencyKey: request.idempotencyKey,
      installationId: `ins_${createHash('sha256').update(`${workspaceId}:${request.idempotencyKey}`).digest('hex').slice(0, 26)}`,
      pluginId: request.payload.pluginId,
      releaseId: request.payload.releaseId,
      requestDigest,
      requestedHarness: request.payload.requestedHarness,
      requiredConnectors: release?.requiredConnectors ?? [],
      requiredCredentials: release?.requiredCredentials ?? [],
      state,
      updatedAt: now,
      userId: request.payload.workspaceIdentity.userId,
      workspaceId,
    }
    return this.#repository.save(record)
  }

  async #stateFor(
    identity: MarketplaceWorkspaceIdentity,
    plugin: MarketplacePlugin,
    release: MarketplaceRelease,
    payload: MarketplaceInstallEnvelope['payload']
  ): Promise<MarketplaceInstallationState> {
    if (release.canonicalContentDigest !== payload.canonicalContentDigest)
      return 'rejected-by-policy'
    if (
      plugin.currentReleaseId !== release.releaseId ||
      (await this.#policy.isSuperseded?.({
        pluginId: plugin.pluginId,
        releaseId: release.releaseId,
      }))
    )
      return 'superseded'
    if (
      await this.#policy.isRevoked?.({
        canonicalContentDigest: release.canonicalContentDigest,
        pluginId: plugin.pluginId,
        releaseId: release.releaseId,
      })
    )
      return 'rejected-by-policy'
    if (release.contentResolution !== 'complete') return 'unavailable'
    const compatibility = plugin.harnessCompatibility[payload.requestedHarness]
    if (
      !isObject(compatibility) ||
      ['unsupported', 'blocked', 'rejected'].includes(stringValue(compatibility['status']))
    )
      return 'rejected-by-policy'
    if (
      this.#policy.authorizeWorkspace &&
      !(await this.#policy.authorizeWorkspace({ identity, plugin, release }))
    )
      return 'rejected-by-policy'
    if (
      this.#policy.authorizeSecurityClassification &&
      !(await this.#policy.authorizeSecurityClassification({
        classification: plugin.securityClassification,
        identity,
      }))
    )
      return 'rejected-by-policy'
    const connectors = await this.#policy.resolveConnectors?.({
      identity,
      names: release.requiredConnectors,
    })
    const credentials = await this.#policy.resolveCredentials?.({
      identity,
      names: release.requiredCredentials,
    })
    if (release.requiredConnectors.length > 0 && connectors?.available !== true)
      return 'pending-authorization'
    if (release.requiredCredentials.length > 0 && credentials?.available !== true)
      return 'pending-authorization'
    if (!(await this.#registry.verifyRelease(plugin, release))) return 'unavailable'
    return 'installed'
  }
}

@Injectable()
export class UnavailableMarketplaceInstallationService implements MarketplaceInstallationAuthority {
  async list(): Promise<readonly MarketplaceInstallationRecord[]> {
    return []
  }

  async install(): Promise<never> {
    throw new Error('MARKETPLACE_INSTALLATION_NOT_CONFIGURED')
  }
}

function parseEnvelope(value: MarketplaceInstallEnvelope): MarketplaceInstallEnvelope {
  if (!isObject(value) || !isObject(value.payload) || !isObject(value.payload.workspaceIdentity))
    throw new BadRequestException({
      code: 'MARKETPLACE_REQUEST_INVALID',
      message: 'Marketplace installation request is invalid',
    })
  const payload = value.payload
  const identity = payload.workspaceIdentity
  if (
    !stringValue(value.workspaceId) ||
    !stringValue(value.idempotencyKey) ||
    !stringValue(payload.pluginId) ||
    !/^release:[a-f0-9]{64}$/.test(stringValue(payload.releaseId)) ||
    !/^sha256:[a-f0-9]{64}$/.test(stringValue(payload.canonicalContentDigest)) ||
    !stringValue(payload.requestedHarness) ||
    !stringValue(identity.workspaceId) ||
    !stringValue(identity.userId) ||
    value.workspaceId !== identity.workspaceId
  )
    throw new BadRequestException({
      code: 'MARKETPLACE_REQUEST_INVALID',
      message: 'Marketplace installation request is invalid',
    })
  return value
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

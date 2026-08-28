import { createHash } from 'node:crypto'
import {
  ContextContributionSchema,
  ContextProviderPolicySchema,
  ContextProviderReadModelSchema,
  IdentifierSchemas,
  type ContextContribution,
  type ContextProviderCapabilities,
  type ContextProviderReadModel,
} from '@control-plane/contracts'
import { z } from 'zod'

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const RequestSchema = z.object({
  workspaceId: IdentifierSchemas.workspaceId,
  scopeDigest: DigestSchema,
  principalRef: z.string().min(1).max(256),
  executionLocation: z.enum(['cloud', 'runtime_node']),
  capability: z.enum(['boundedRetrieval', 'evidenceSearch', 'memoryRecall']),
  now: z.iso.datetime(),
  policy: ContextProviderPolicySchema,
})

export type ContextProviderRequest = z.output<typeof RequestSchema>

export interface ContextProviderDriver {
  readonly readModel: ContextProviderReadModel
  retrieve(request: ContextProviderRequest): Promise<ContextContribution[]>
}

export interface ContextContributionCache {
  get(key: string): Promise<ContextContribution[] | undefined>
  set(key: string, contributions: ContextContribution[]): Promise<void>
}

export class InMemoryContextContributionCache implements ContextContributionCache {
  readonly #entries = new Map<string, ContextContribution[]>()
  async get(key: string): Promise<ContextContribution[] | undefined> {
    const value = this.#entries.get(key)
    return value === undefined ? undefined : structuredClone(value)
  }
  async set(key: string, contributions: ContextContribution[]): Promise<void> {
    this.#entries.set(key, structuredClone(contributions))
  }
}

export type ContextProviderErrorCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_REVOKED'
  | 'PROVIDER_SCOPE_MISMATCH'
  | 'PROVIDER_OUTPUT_INVALID'
  | 'PROVIDER_OUTPUT_STALE'
  | 'PROVIDER_BUDGET_EXCEEDED'

export class ContextProviderResolutionError extends Error {
  constructor(readonly code: ContextProviderErrorCode) {
    super(code)
    this.name = 'ContextProviderResolutionError'
  }
}

export interface ContextProviderPin {
  providerId: string
  connectionId: string
  contractVersion: string
  scopeDigest: string
  revision?: string
  contentDigest?: string
  observedAt?: string
  degraded: boolean
  included: boolean
  omissionReason?: ContextProviderErrorCode | 'NO_ELIGIBLE_PROVIDER'
  provenance: Array<{ sourceRef: string; sourceKind: string; citation?: string }>
  providerMetadata?: ContextContribution['providerMetadata']
}

export interface ContextProviderResolution {
  status: 'disabled' | 'omitted' | 'awaiting_input' | 'included' | 'degraded'
  contributions: ContextContribution[]
  pins: ContextProviderPin[]
}

export class ContextProviderResolver {
  readonly #providers: ContextProviderDriver[]
  readonly #cache: ContextContributionCache | undefined
  constructor(
    providers: ContextProviderDriver[],
    options: { readonly cache?: ContextContributionCache } = {}
  ) {
    this.#providers = [...providers]
    this.#cache = options.cache
  }

  async resolve(input: unknown): Promise<ContextProviderResolution> {
    const request = RequestSchema.parse(input)
    if (request.policy.mode === 'disabled') return empty('disabled')
    const providers = this.#eligible(request)
    let lastError: ContextProviderResolutionError | undefined
    for (const provider of providers) {
      try {
        if (provider.readModel.connection.state === 'revoked')
          throw new ContextProviderResolutionError('PROVIDER_REVOKED')
        if (provider.readModel.health.status === 'unavailable')
          throw new ContextProviderResolutionError('PROVIDER_UNAVAILABLE')
        const cacheKey = this.#cacheKey(provider, request)
        const cached = await this.#cache?.get(cacheKey)
        if (cached) {
          const normalizedCached = this.#validate(provider, request, cached)
          return this.#included(provider, normalizedCached)
        }
        const contributions = await withTimeout(
          provider.retrieve(request),
          request.policy.maximumLatencyMs
        )
        const normalized = this.#validate(provider, request, contributions)
        await this.#cache?.set(cacheKey, normalized)
        return this.#included(provider, normalized)
      } catch (error) {
        lastError = normalizeError(error)
      }
    }
    return this.#failure(request, lastError)
  }

  #included(
    provider: ContextProviderDriver,
    normalized: ContextContribution[]
  ): ContextProviderResolution {
    return {
      status:
        provider.readModel.health.status === 'degraded' ||
        normalized.some((entry) => entry.degraded)
          ? 'degraded'
          : 'included',
      contributions: normalized,
      pins: normalized.map((entry) => ({
        providerId: entry.providerId,
        connectionId: entry.connectionId,
        contractVersion: entry.contractVersion,
        scopeDigest: entry.scopeDigest,
        revision: entry.revision,
        contentDigest: entry.contentDigest,
        observedAt: entry.observedAt,
        degraded: entry.degraded,
        included: true,
        provenance: entry.provenance.map(({ sourceRef, sourceKind, citation }) => ({
          sourceRef,
          sourceKind,
          ...(citation === undefined ? {} : { citation }),
        })),
        ...(entry.providerMetadata === undefined
          ? {}
          : { providerMetadata: entry.providerMetadata }),
      })),
    }
  }

  #cacheKey(provider: ContextProviderDriver, request: ContextProviderRequest): string {
    return digest(
      JSON.stringify({
        provider: provider.readModel.definition,
        connection: provider.readModel.connection,
        workspaceId: request.workspaceId,
        scopeDigest: request.scopeDigest,
        principalRef: request.principalRef,
        capability: request.capability,
        policy: request.policy,
        nowBucket: Math.floor(
          Date.parse(request.now) / (request.policy.maximumAgeSeconds * 1_000 || 1)
        ),
        adapterVersion: 'context-provider-resolver/1',
      })
    )
  }

  #eligible(request: ContextProviderRequest): ContextProviderDriver[] {
    const preference = new Map(request.policy.providerIds.map((id, index) => [id, index]))
    return this.#providers
      .filter(({ readModel }) => {
        const { connection, definition } = readModel
        return (
          connection.workspaceId === request.workspaceId &&
          connection.scopeDigest === request.scopeDigest &&
          connection.principalRef === request.principalRef &&
          connection.executionLocations.includes(request.executionLocation) &&
          definition.capabilities[request.capability] &&
          (request.policy.providerIds.length === 0 ||
            request.policy.providerIds.includes(definition.providerId))
        )
      })
      .sort((left, right) => {
        const leftRank =
          preference.get(left.readModel.definition.providerId) ?? Number.MAX_SAFE_INTEGER
        const rightRank =
          preference.get(right.readModel.definition.providerId) ?? Number.MAX_SAFE_INTEGER
        return (
          leftRank - rightRank ||
          left.readModel.definition.providerId.localeCompare(right.readModel.definition.providerId)
        )
      })
  }

  #validate(
    provider: ContextProviderDriver,
    request: ContextProviderRequest,
    input: unknown
  ): ContextContribution[] {
    const parsed = z.array(ContextContributionSchema).max(128).safeParse(input)
    if (!parsed.success) throw new ContextProviderResolutionError('PROVIDER_OUTPUT_INVALID')
    let tokens = 0
    for (const entry of parsed.data) {
      if (
        entry.providerId !== provider.readModel.definition.providerId ||
        entry.connectionId !== provider.readModel.connection.connectionId ||
        entry.contractVersion !== provider.readModel.definition.contractVersion
      )
        throw new ContextProviderResolutionError('PROVIDER_OUTPUT_INVALID')
      if (entry.scopeDigest !== request.scopeDigest)
        throw new ContextProviderResolutionError('PROVIDER_SCOPE_MISMATCH')
      const observedAge = Date.parse(request.now) - Date.parse(entry.observedAt)
      if (
        (entry.expiresAt && Date.parse(entry.expiresAt) <= Date.parse(request.now)) ||
        observedAge < 0 ||
        observedAge > request.policy.maximumAgeSeconds * 1_000
      )
        throw new ContextProviderResolutionError('PROVIDER_OUTPUT_STALE')
      if (
        (entry.kind === 'evidence' && !request.policy.includeEvidence) ||
        (entry.kind === 'memory' && !request.policy.includeMemory)
      )
        throw new ContextProviderResolutionError('PROVIDER_OUTPUT_INVALID')
      tokens += entry.tokenCount
    }
    if (tokens > request.policy.maximumTokens)
      throw new ContextProviderResolutionError('PROVIDER_BUDGET_EXCEEDED')
    return [...parsed.data].sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.contributionId.localeCompare(right.contributionId)
    )
  }

  #failure(
    request: ContextProviderRequest,
    error?: ContextProviderResolutionError
  ): ContextProviderResolution {
    const resolvedError = error ?? new ContextProviderResolutionError('PROVIDER_UNAVAILABLE')
    if (request.policy.failureBehavior === 'fail' || request.policy.mode === 'required') {
      if (request.policy.failureBehavior !== 'await_input') throw resolvedError
    }
    if (request.policy.failureBehavior === 'await_input') return empty('awaiting_input')
    return empty('omitted')
  }
}

export interface FakeContextProviderOptions {
  suffix: string
  workspaceId: string
  scopeDigest: string
  outputScopeDigest?: string
  state: 'active' | 'revoked'
  health: 'healthy' | 'degraded' | 'unavailable'
  capabilities: Partial<ContextProviderCapabilities>
  kind: 'context' | 'evidence' | 'memory'
  tokenCount: number
  delayMs?: number
  expiresAt?: string
  degraded?: boolean
}

export function createFakeContextProvider(
  options: FakeContextProviderOptions
): ContextProviderDriver {
  const token = options.suffix.toUpperCase().replace(/[^0-9A-HJKMNP-TV-Z]/g, 'A')[0] ?? 'A'
  const providerId = `ctp_${token.repeat(26)}`
  const connectionId = `ctc_${token.repeat(26)}`
  const capabilities = {
    boundedRetrieval: true,
    evidenceSearch: false,
    memoryRecall: false,
    healthStatus: true,
    memoryWriteProposal: false,
    memoryWriteCommit: false,
    ...options.capabilities,
  }
  const readModel = ContextProviderReadModelSchema.parse({
    definition: {
      providerId,
      providerType: options.kind === 'memory' ? 'fake-memory' : 'fake-evidence',
      displayName: `Fake ${options.suffix}`,
      contractVersion: '1.0.0',
      capabilities,
    },
    connection: {
      connectionId,
      providerId,
      workspaceId: options.workspaceId,
      principalRef: 'principal://test/user',
      scopeDigest: options.scopeDigest,
      executionLocations: ['cloud', 'runtime_node'],
      state: options.state,
    },
    health: { status: options.health, checkedAt: '2026-08-25T11:59:00.000Z' },
  })
  return {
    readModel,
    async retrieve() {
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs))
      if (options.health === 'unavailable')
        throw new ContextProviderResolutionError('PROVIDER_UNAVAILABLE')
      const content = `${options.kind}-${options.suffix}`
      return [
        ContextContributionSchema.parse({
          providerId,
          connectionId,
          contractVersion: '1.0.0',
          contributionId: `contribution-${options.suffix}`,
          kind: options.kind,
          content,
          tokenCount: options.tokenCount,
          observedAt: '2026-08-25T11:59:00.000Z',
          ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
          scopeDigest: options.outputScopeDigest ?? options.scopeDigest,
          revision: `revision-${options.suffix}`,
          contentDigest: digest(content),
          degraded: options.degraded ?? false,
          provenance: [
            {
              sourceRef: `fixture://${options.suffix}`,
              citation: `fixture ${options.suffix}`,
              sourceKind: options.kind === 'memory' ? 'provider_memory' : 'external_evidence',
            },
          ],
        }),
      ]
    },
  }
}

export async function runContextProviderConformance(
  provider: ContextProviderDriver,
  requestInput: unknown
): Promise<{ bounded: boolean; deterministic: boolean; scopePreserved: boolean }> {
  const request = RequestSchema.parse(requestInput)
  const first = await provider.retrieve(request)
  const second = await provider.retrieve(request)
  return {
    bounded:
      first.length <= 128 &&
      first.reduce((sum, contribution) => sum + contribution.tokenCount, 0) <=
        request.policy.maximumTokens,
    deterministic: JSON.stringify(first) === JSON.stringify(second),
    scopePreserved: first.every((contribution) => contribution.scopeDigest === request.scopeDigest),
  }
}

function normalizeError(error: unknown): ContextProviderResolutionError {
  return error instanceof ContextProviderResolutionError
    ? error
    : new ContextProviderResolutionError('PROVIDER_UNAVAILABLE')
}

function empty(status: ContextProviderResolution['status']): ContextProviderResolution {
  return { status, contributions: [], pins: [] }
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

async function withTimeout<Value>(
  promise: Promise<Value>,
  maximumLatencyMs: number
): Promise<Value> {
  let timeout: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new ContextProviderResolutionError('PROVIDER_UNAVAILABLE')),
          maximumLatencyMs
        )
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

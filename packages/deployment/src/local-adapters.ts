import type {
  CoordinationLease,
  CoordinationProvider,
  DeploymentComponentHealth,
  ObservabilityEvent,
  ObservabilityProvider,
  ServiceDiscovery,
  ServiceEndpoint,
} from './index.js'

const SERVICE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/

export class StaticServiceDiscovery implements ServiceDiscovery {
  readonly #endpoints: ReadonlyMap<string, ServiceEndpoint>

  constructor(endpoints: readonly ServiceEndpoint[]) {
    const mapped = new Map<string, ServiceEndpoint>()
    for (const endpoint of endpoints) {
      if (!SERVICE_PATTERN.test(endpoint.service) || mapped.has(endpoint.service)) {
        throw new Error('INVALID_SERVICE_DISCOVERY_CONFIGURATION')
      }
      mapped.set(endpoint.service, Object.freeze({ ...endpoint, url: new URL(endpoint.url) }))
    }
    this.#endpoints = mapped
  }

  async resolve(service: string): Promise<ServiceEndpoint> {
    const endpoint = this.#endpoints.get(service)
    if (endpoint === undefined) throw new Error('SERVICE_ENDPOINT_NOT_FOUND')
    return { ...endpoint, url: new URL(endpoint.url) }
  }
}

interface LeaseState {
  readonly owner: string
  readonly token: symbol
  readonly expiresAt: number
}

export class LocalCoordinationProvider implements CoordinationProvider {
  readonly #leases = new Map<string, LeaseState>()
  readonly #now: () => number
  #closed = false

  constructor(now: () => number = Date.now) {
    this.#now = now
  }

  async acquire(key: string, owner: string, ttlMs: number): Promise<CoordinationLease | undefined> {
    if (this.#closed) throw new Error('COORDINATION_PROVIDER_CLOSED')
    if (
      !SERVICE_PATTERN.test(key) ||
      !SERVICE_PATTERN.test(owner) ||
      ttlMs < 1 ||
      ttlMs > 86_400_000
    ) {
      throw new Error('INVALID_COORDINATION_LEASE')
    }
    const now = this.#now()
    const existing = this.#leases.get(key)
    if (existing !== undefined && existing.expiresAt > now) return undefined
    const token = Symbol(key)
    const expiresAt = now + ttlMs
    this.#leases.set(key, { owner, token, expiresAt })
    let released = false
    return {
      key,
      owner,
      expiresAt: new Date(expiresAt).toISOString(),
      release: async () => {
        if (released) return
        released = true
        if (this.#leases.get(key)?.token === token) this.#leases.delete(key)
      },
    }
  }

  close(): void {
    this.#closed = true
    this.#leases.clear()
  }
}

export class BufferedObservabilityProvider implements ObservabilityProvider {
  readonly #maximumEvents: number
  readonly #events: ObservabilityEvent[] = []
  #closed = false

  constructor(maximumEvents = 1_000) {
    if (!Number.isInteger(maximumEvents) || maximumEvents < 1 || maximumEvents > 100_000) {
      throw new Error('INVALID_OBSERVABILITY_BUFFER_SIZE')
    }
    this.#maximumEvents = maximumEvents
  }

  get events(): readonly ObservabilityEvent[] {
    return structuredClone(this.#events)
  }

  record(event: ObservabilityEvent): void {
    if (this.#closed) throw new Error('OBSERVABILITY_PROVIDER_CLOSED')
    if (!SERVICE_PATTERN.test(event.name) || !Number.isFinite(Date.parse(event.occurredAt))) {
      throw new Error('INVALID_OBSERVABILITY_EVENT')
    }
    this.#events.push(structuredClone(event))
    if (this.#events.length > this.#maximumEvents) this.#events.shift()
  }

  async health(): Promise<DeploymentComponentHealth> {
    return {
      ready: !this.#closed,
      component: 'buffered-observability',
      version: '1',
      details: { bufferedEvents: this.#events.length },
    }
  }

  close(): void {
    this.#closed = true
    this.#events.length = 0
  }
}

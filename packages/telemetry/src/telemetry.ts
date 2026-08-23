import { semanticAttributes } from './context.js'
import { redactTelemetryValue, sanitizeAttributes } from './redaction.js'
import type {
  ErrorTracker,
  MetricAdapter,
  StructuredLogger,
  TelemetryIdentifiers,
  TelemetrySpan,
  TraceAdapter,
  TraceContext,
} from './types.js'

const noopSpan: TelemetrySpan = { end: () => undefined }
const noopTraceAdapter: TraceAdapter = { startSpan: () => noopSpan }
const noopMetricAdapter: MetricAdapter = { add: () => undefined }
const noopErrorTracker: ErrorTracker = { captureException: () => undefined }

export interface TelemetryOptions {
  readonly serviceName: string
  readonly logger?: StructuredLogger
  readonly traceAdapter?: TraceAdapter
  readonly metricAdapter?: MetricAdapter
  readonly errorTracker?: ErrorTracker
}

export class Telemetry {
  readonly #serviceName: string
  readonly #logger: StructuredLogger | undefined
  readonly #traceAdapter: TraceAdapter
  readonly #metricAdapter: MetricAdapter
  readonly #errorTracker: ErrorTracker

  constructor(options: TelemetryOptions) {
    this.#serviceName = options.serviceName
    this.#logger = options.logger
    this.#traceAdapter = options.traceAdapter ?? noopTraceAdapter
    this.#metricAdapter = options.metricAdapter ?? noopMetricAdapter
    this.#errorTracker = options.errorTracker ?? noopErrorTracker
  }

  startSpan(
    name: string,
    identifiers: TelemetryIdentifiers = {},
    attributes: Readonly<Record<string, unknown>> = {},
    parent?: TraceContext
  ): TelemetrySpan {
    return this.#traceAdapter.startSpan({
      name,
      attributes: {
        ...semanticAttributes({ serviceName: this.#serviceName, ...identifiers }),
        ...sanitizeAttributes(attributes),
      },
      ...(parent === undefined ? {} : { parent }),
    })
  }

  withServiceSpan<Result>(
    name: string,
    identifiers: TelemetryIdentifiers,
    operation: () => Result | Promise<Result>
  ): Promise<Result> {
    return this.#withSpan(`service.${name}`, identifiers, operation)
  }

  withDatabaseSpan<Result>(
    name: string,
    identifiers: TelemetryIdentifiers,
    operation: () => Result | Promise<Result>
  ): Promise<Result> {
    return this.#withSpan(`database.${name}`, identifiers, operation)
  }

  increment(name: string, value: number, identifiers: TelemetryIdentifiers = {}): void {
    this.#metricAdapter.add(
      name,
      value,
      semanticAttributes({ serviceName: this.#serviceName, ...identifiers })
    )
  }

  log(
    level: 'error' | 'info' | 'warn',
    event: string,
    identifiers: TelemetryIdentifiers,
    details?: unknown
  ): void {
    this.#logger?.write({
      level,
      event,
      metadata: semanticAttributes({ serviceName: this.#serviceName, ...identifiers }),
      ...(details === undefined ? {} : { details: redactTelemetryValue(details) }),
    })
  }

  async #withSpan<Result>(
    name: string,
    identifiers: TelemetryIdentifiers,
    operation: () => Result | Promise<Result>
  ): Promise<Result> {
    const span = this.startSpan(name, identifiers)
    try {
      const result = await operation()
      span.end({ status: 'ok' })
      return result
    } catch (error) {
      const safeError = redactTelemetryValue(error)
      span.end({ status: 'error', error: safeError })
      this.#errorTracker.captureException(
        safeError,
        semanticAttributes({ serviceName: this.#serviceName, ...identifiers })
      )
      throw error
    }
  }
}

export function createTelemetry(options: TelemetryOptions): Telemetry {
  return new Telemetry(options)
}

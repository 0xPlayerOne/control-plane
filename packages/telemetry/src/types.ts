export type TelemetryAttributeValue = boolean | number | string

export interface TelemetryIdentifiers {
  readonly serviceName?: string
  readonly requestId?: string
  readonly correlationId?: string
  readonly workspaceId?: string
  readonly executionId?: string
  readonly attemptId?: string
  readonly workflowId?: string
  readonly runtimeId?: string
}

export interface TraceContext {
  readonly traceparent: string
  readonly tracestate?: string
}

export interface SpanInput {
  readonly name: string
  readonly attributes: Readonly<Record<string, TelemetryAttributeValue>>
  readonly parent?: TraceContext
}

export interface SpanOutcome {
  readonly status: 'error' | 'ok'
  readonly error?: unknown
}

export interface TelemetrySpan {
  readonly context?: TraceContext
  end(outcome: SpanOutcome): void
}

export interface TraceAdapter {
  startSpan(input: SpanInput): TelemetrySpan
}

export interface MetricAdapter {
  add(
    name: string,
    value: number,
    attributes: Readonly<Record<string, TelemetryAttributeValue>>
  ): void
}

export interface ErrorTracker {
  captureException(error: unknown, context: unknown): void
  flush?(): Promise<void>
}

export interface StructuredLogEntry {
  readonly level: 'error' | 'info' | 'warn'
  readonly event: string
  readonly metadata?: Readonly<object>
  readonly details?: unknown
}

export interface StructuredLogger {
  write(entry: StructuredLogEntry): void
}

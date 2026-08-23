import { describe, expect, test } from 'bun:test'
import {
  createStructuredLogger,
  createSentryErrorTracker,
  createTelemetry,
  extractTraceContext,
  injectTraceContext,
  redactTelemetryValue,
  semanticAttributes,
} from './index.ts'

const identifiers = {
  serviceName: 'control-api',
  requestId: 'request-1',
  correlationId: 'correlation-1',
  workspaceId: 'workspace-1',
  executionId: 'execution-1',
  attemptId: 'attempt-1',
  workflowId: 'workflow-1',
  runtimeId: 'runtime-1',
}

describe('telemetry safety and correlation', () => {
  test('redacts secret and prohibited payload fields without mutating input', () => {
    const input = {
      authorization: 'Bearer private',
      nested: {
        apiKey: 'api-key',
        prompt: 'private prompt',
        safe: 'visible',
      },
      error: new Error('failed with token=private-token'),
    }

    const redacted = redactTelemetryValue(input)

    expect(JSON.stringify(redacted)).not.toContain('private')
    expect(redacted).toEqual({
      authorization: '[REDACTED]',
      nested: { apiKey: '[REDACTED]', prompt: '[REDACTED]', safe: 'visible' },
      error: { name: 'Error', message: 'failed with token=[REDACTED]' },
    })
    expect(input.nested.safe).toBe('visible')
  })

  test('writes stable redacted JSON log fields', () => {
    const lines = []
    const logger = createStructuredLogger({
      now: () => new Date('2026-08-23T12:00:00.000Z'),
      writeLine: (line) => lines.push(line),
    })

    logger.write({
      level: 'info',
      event: 'service.operation',
      metadata: { serviceName: 'control-api' },
      details: { correlationId: 'correlation-1', password: 'private' },
    })

    expect(JSON.parse(lines[0])).toEqual({
      timestamp: '2026-08-23T12:00:00.000Z',
      level: 'info',
      event: 'service.operation',
      metadata: { serviceName: 'control-api' },
      details: { correlationId: 'correlation-1', password: '[REDACTED]' },
    })
  })

  test('maps every semantic identifier to stable attributes', () => {
    expect(semanticAttributes(identifiers)).toEqual({
      'service.name': 'control-api',
      'request.id': 'request-1',
      'control.correlation_id': 'correlation-1',
      'workspace.id': 'workspace-1',
      'execution.id': 'execution-1',
      'execution.attempt.id': 'attempt-1',
      'workflow.id': 'workflow-1',
      'runtime.id': 'runtime-1',
    })
  })

  test('propagates only valid W3C trace context across a carrier boundary', () => {
    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    const context = extractTraceContext({ traceparent, tracestate: 'vendor=value' })
    const carrier = {}

    injectTraceContext(context, carrier)

    expect(carrier).toEqual({ traceparent, tracestate: 'vendor=value' })
    expect(extractTraceContext({ traceparent: 'unsafe' })).toBeUndefined()
  })

  test('records service and database spans and reports sanitized failures', async () => {
    const spans = []
    const errors = []
    const telemetry = createTelemetry({
      serviceName: 'control-api',
      traceAdapter: {
        startSpan(input) {
          const record = { input, outcome: undefined }
          spans.push(record)
          return {
            context: {
              traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
            },
            end(outcome) {
              record.outcome = outcome
            },
          }
        },
      },
      errorTracker: {
        captureException(error, context) {
          errors.push({ error, context })
        },
      },
    })

    await telemetry.withServiceSpan('execution.create', identifiers, async () => 'created')
    await expect(
      telemetry.withDatabaseSpan(
        'transaction.commit',
        { ...identifiers, workspaceId: undefined },
        async () => {
          throw new Error('failed with password=private')
        }
      )
    ).rejects.toThrow('failed')

    expect(spans.map(({ input }) => input.name)).toEqual([
      'service.execution.create',
      'database.transaction.commit',
    ])
    expect(spans.map(({ outcome }) => outcome.status)).toEqual(['ok', 'error'])
    expect(JSON.stringify(errors)).not.toContain('private')
  })

  test('configures Sentry without PII and redacts captured diagnostics', async () => {
    const calls = { captured: [], contexts: [], initialized: [] }
    const sdk = {
      captureException(error) {
        calls.captured.push(error)
      },
      async flush() {
        return true
      },
      init(options) {
        calls.initialized.push(options)
      },
      withScope(operation) {
        operation({ setContext: (_name, context) => calls.contexts.push(context) })
      },
    }
    const tracker = await createSentryErrorTracker({
      dsn: 'https://public@example.invalid/1',
      environment: 'test',
      release: '1.0.0',
      sdk,
    })

    tracker.captureException(new Error('token=private'), { authorization: 'private' })
    await tracker.flush?.()

    expect(calls.initialized[0]).toEqual(
      expect.objectContaining({ enabled: true, sendDefaultPii: false })
    )
    expect(JSON.stringify({ captured: calls.captured, contexts: calls.contexts })).not.toContain(
      'private'
    )
  })
})

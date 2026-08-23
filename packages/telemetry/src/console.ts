import { randomBytes } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { traceIdFromContext } from './context.js'
import type { StructuredLogger, TraceAdapter, TraceContext } from './types.js'

export function createConsoleTraceAdapter(logger: StructuredLogger): TraceAdapter {
  return {
    startSpan(input) {
      const startedAt = performance.now()
      const context = childTraceContext(input.parent)
      return {
        context,
        end(outcome) {
          logger.write({
            level: outcome.status === 'error' ? 'error' : 'info',
            event: 'telemetry.span.completed',
            metadata: input.attributes,
            details: {
              durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
              name: input.name,
              spanId: context.traceparent.split('-')[2],
              status: outcome.status,
              traceId: traceIdFromContext(context),
              ...(outcome.error === undefined ? {} : { error: outcome.error }),
            },
          })
        },
      }
    },
  }
}

function childTraceContext(parent: TraceContext | undefined): TraceContext {
  const traceId = traceIdFromContext(parent) ?? randomBytes(16).toString('hex')
  const traceparent = `00-${traceId}-${randomBytes(8).toString('hex')}-01`
  return parent?.tracestate === undefined
    ? { traceparent }
    : { traceparent, tracestate: parent.tracestate }
}

import { sanitizeAttributes } from './redaction.js'
import type { SpanOutcome, TelemetrySpan, TraceAdapter } from './types.js'

export interface LangSmithRunPort {
  end(outcome: SpanOutcome): void
}

export interface LangSmithClientPort {
  startRun(input: {
    readonly name: string
    readonly metadata: Readonly<Record<string, boolean | number | string>>
  }): LangSmithRunPort
}

export function createLangSmithTraceAdapter(options: {
  readonly enabled?: boolean
  readonly client: LangSmithClientPort
}): TraceAdapter {
  return {
    startSpan(input): TelemetrySpan {
      if (options.enabled === false) return { end: () => undefined }
      const run = options.client.startRun({
        name: input.name,
        metadata: sanitizeAttributes(input.attributes),
      })
      return {
        ...(input.parent === undefined ? {} : { context: input.parent }),
        end(outcome) {
          run.end(outcome)
        },
      }
    },
  }
}

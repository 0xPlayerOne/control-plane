import type { TelemetryIdentifiers, TraceContext } from './types.js'

const traceparentPattern = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/
const invalidTraceId = /^0{32}$/
const invalidSpanId = /^0{16}$/

export function semanticAttributes(
  identifiers: TelemetryIdentifiers
): Readonly<Record<string, string>> {
  const attributes: Record<string, string> = {}
  const mappings = [
    ['service.name', identifiers.serviceName],
    ['request.id', identifiers.requestId],
    ['control.correlation_id', identifiers.correlationId],
    ['workspace.id', identifiers.workspaceId],
    ['execution.id', identifiers.executionId],
    ['execution.attempt.id', identifiers.attemptId],
    ['workflow.id', identifiers.workflowId],
    ['runtime.id', identifiers.runtimeId],
    ['runtime.node.id', identifiers.runtimeNodeId],
    ['agent.profile.version', identifiers.profileVersion],
    ['agent.skill.version', identifiers.skillVersion],
    ['agent.graph.version', identifiers.graphVersion],
    ['gen_ai.request.model', identifiers.modelAlias],
    ['tool.id', identifiers.toolId],
    ['policy.version', identifiers.policyVersion],
    ['sandbox.id', identifiers.sandboxId],
    ['delegation.id', identifiers.delegationId],
  ] as const
  for (const [key, value] of mappings) if (value !== undefined) attributes[key] = value
  return attributes
}

export function extractTraceContext(
  carrier: Readonly<Record<string, unknown>>
): TraceContext | undefined {
  const rawTraceparent = header(carrier, 'traceparent')
  if (rawTraceparent === undefined) return undefined
  const traceparent = rawTraceparent.toLowerCase()
  const match = traceparent.match(traceparentPattern)
  if (!match || invalidTraceId.test(match[1] ?? '') || invalidSpanId.test(match[2] ?? '')) {
    return undefined
  }
  const tracestate = header(carrier, 'tracestate')
  if (tracestate !== undefined && (tracestate.length > 512 || /[^\x20-\x7e]/.test(tracestate))) {
    return { traceparent }
  }
  return tracestate === undefined ? { traceparent } : { traceparent, tracestate }
}

export function injectTraceContext(
  context: TraceContext | undefined,
  carrier: Record<string, string>
): void {
  if (!context) return
  carrier['traceparent'] = context.traceparent
  if (context.tracestate !== undefined) carrier['tracestate'] = context.tracestate
}

export function traceIdFromContext(context: TraceContext | undefined): string | undefined {
  return context?.traceparent.match(traceparentPattern)?.[1]
}

function header(carrier: Readonly<Record<string, unknown>>, name: string): string | undefined {
  for (const [key, value] of Object.entries(carrier)) {
    if (key.toLowerCase() === name && typeof value === 'string') return value
  }
  return undefined
}

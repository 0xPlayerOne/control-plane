import { randomUUID } from 'node:crypto'
import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify'
import {
  extractTraceContext,
  injectTraceContext,
  type TraceContext,
} from '@control-plane/telemetry'

const contextIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string
    traceContext: TraceContext | undefined
  }
}

export function requestIdFromHeaders(request: { headers: Record<string, unknown> }): string {
  return validContextId(request.headers['x-request-id']) ?? randomUUID()
}

export function attachRequestContext(
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction
): void {
  const correlationId = validContextId(request.headers['x-correlation-id']) ?? request.id
  request.correlationId = correlationId
  request.traceContext = extractTraceContext({ ...request.headers })
  reply.header('x-request-id', request.id)
  reply.header('x-correlation-id', correlationId)
  const traceHeaders: Record<string, string> = {}
  injectTraceContext(request.traceContext, traceHeaders)
  for (const [name, value] of Object.entries(traceHeaders)) reply.header(name, value)
  done()
}

export function responseMetadata(request: FastifyRequest) {
  return { correlationId: request.correlationId, requestId: request.id }
}

function validContextId(value: unknown): string | undefined {
  return typeof value === 'string' && contextIdPattern.test(value) ? value : undefined
}

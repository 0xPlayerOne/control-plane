import { randomUUID } from 'node:crypto'
import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify'

const contextIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string
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
  reply.header('x-request-id', request.id)
  reply.header('x-correlation-id', correlationId)
  done()
}

export function responseMetadata(request: FastifyRequest) {
  return { correlationId: request.correlationId, requestId: request.id }
}

function validContextId(value: unknown): string | undefined {
  return typeof value === 'string' && contextIdPattern.test(value) ? value : undefined
}

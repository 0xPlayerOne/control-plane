import { HttpException, Inject, Injectable } from '@nestjs/common'
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Observable } from 'rxjs'
import { tap } from 'rxjs'
import { API_LOGGER, API_TELEMETRY } from './tokens.js'
import type { StructuredLogger } from '@control-plane/bootstrap'
import { Telemetry, traceIdFromContext, type TelemetrySpan } from '@control-plane/telemetry'

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  constructor(
    @Inject(API_LOGGER) private readonly logger: StructuredLogger,
    @Inject(API_TELEMETRY) private readonly telemetry: Telemetry
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp()
    const request = http.getRequest<FastifyRequest>()
    const reply = http.getResponse<FastifyReply>()
    const startedAt = performance.now()
    const span = this.telemetry.startSpan(
      'http.request',
      {
        correlationId: request.correlationId,
        requestId: request.id,
      },
      { 'http.request.method': request.method, 'http.route': request.routeOptions.url },
      request.traceContext
    )
    return next.handle().pipe(
      tap({
        next: () => this.complete(request, reply.statusCode, startedAt, span),
        error: (error: unknown) =>
          this.complete(
            request,
            error instanceof HttpException ? error.getStatus() : 500,
            startedAt,
            span,
            error
          ),
      })
    )
  }

  private complete(
    request: FastifyRequest,
    statusCode: number,
    startedAt: number,
    span: TelemetrySpan,
    error?: unknown
  ): void {
    span.end(error === undefined ? { status: 'ok' } : { status: 'error', error })
    this.logger.write({
      level: 'info',
      event: 'http.request.completed',
      details: {
        correlationId: request.correlationId,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        method: request.method,
        requestId: request.id,
        route: request.routeOptions.url,
        statusCode,
        traceId: traceIdFromContext(span.context ?? request.traceContext),
      },
    })
  }
}

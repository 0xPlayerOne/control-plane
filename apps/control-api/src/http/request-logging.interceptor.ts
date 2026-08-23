import { HttpException, Inject, Injectable } from '@nestjs/common'
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Observable } from 'rxjs'
import { tap } from 'rxjs'
import { API_LOGGER } from './tokens.js'
import type { StructuredLogger } from '@control-plane/bootstrap'

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  constructor(@Inject(API_LOGGER) private readonly logger: StructuredLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp()
    const request = http.getRequest<FastifyRequest>()
    const reply = http.getResponse<FastifyReply>()
    const startedAt = performance.now()
    return next.handle().pipe(
      tap({
        next: () => this.write(request, reply.statusCode, startedAt),
        error: (error: unknown) =>
          this.write(request, error instanceof HttpException ? error.getStatus() : 500, startedAt),
      })
    )
  }

  private write(request: FastifyRequest, statusCode: number, startedAt: number): void {
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
      },
    })
  }
}

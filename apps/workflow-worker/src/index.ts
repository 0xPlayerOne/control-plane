import {
  bootstrapService,
  jsonLogger,
  type ProcessAdapter,
  type StructuredLogger,
} from '@control-plane/bootstrap'
import type { RawEnvironment } from '@control-plane/config'
import {
  createConsoleTraceAdapter,
  createOpenTelemetryMetricAdapter,
  createOpenTelemetryTraceAdapter,
  createTelemetry,
  type TraceAdapter,
} from '@control-plane/telemetry'
import { createTemporalWorkerFactory, type TemporalWorkerFactory } from './temporal-worker.js'

export const serviceName = 'workflow-worker'

export interface WorkflowWorkerStartOptions {
  readonly environment?: RawEnvironment
  readonly logger?: StructuredLogger
  readonly processAdapter?: ProcessAdapter
  readonly traceAdapter?: TraceAdapter
  readonly temporalWorkerFactory?: TemporalWorkerFactory
}

export const start = (options: WorkflowWorkerStartOptions = {}) => {
  const logger = options.logger ?? jsonLogger
  return bootstrapService({
    serviceName,
    ...(options.environment === undefined ? {} : { environment: options.environment }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.processAdapter === undefined ? {} : { processAdapter: options.processAdapter }),
    start: async ({ markReady, metadata, registerResource }) => {
      const traceAdapter =
        options.traceAdapter ??
        (metadata.environment === 'development'
          ? createConsoleTraceAdapter(logger)
          : createOpenTelemetryTraceAdapter(serviceName))
      const telemetry = createTelemetry({
        serviceName,
        logger,
        traceAdapter,
        metricAdapter: createOpenTelemetryMetricAdapter(serviceName),
      })
      await telemetry.withServiceSpan(
        'worker.initialize',
        { correlationId: metadata.instanceId },
        async () => {
          const factory =
            options.temporalWorkerFactory ??
            (metadata.environment === 'test'
              ? {
                  create: async () => ({
                    run: async () => undefined,
                    shutdown: async () => undefined,
                  }),
                }
              : createTemporalWorkerFactory({ address: '127.0.0.1:7233', namespace: 'default' }))
          const worker = await factory.create()
          registerResource('temporal-worker', () => worker.shutdown())
          void worker.run().catch((error: unknown) =>
            logger.write({
              level: 'error',
              event: 'workflow.worker.failed',
              details: { message: error instanceof Error ? error.message : 'Unknown worker error' },
            })
          )
          markReady()
        }
      )
    },
  })
}

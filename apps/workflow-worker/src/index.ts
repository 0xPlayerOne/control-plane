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
import { createRestateEndpointFactory, type RestateEndpointFactory } from './restate-worker.js'

export const serviceName = 'workflow-worker'

export interface WorkflowWorkerStartOptions {
  readonly environment?: RawEnvironment
  readonly logger?: StructuredLogger
  readonly processAdapter?: ProcessAdapter
  readonly traceAdapter?: TraceAdapter
  readonly restateEndpointFactory?: RestateEndpointFactory
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
            options.restateEndpointFactory ??
            (metadata.environment === 'test'
              ? {
                  create: async () => ({
                    run: async () => undefined,
                    shutdown: async () => undefined,
                  }),
                }
              : createRestateEndpointFactory())
          const endpoint = await factory.create()
          registerResource('restate-endpoint', () => endpoint.shutdown())
          void endpoint.run().catch((error: unknown) =>
            logger.write({
              level: 'error',
              event: 'workflow.restate_endpoint.failed',
              details: { message: error instanceof Error ? error.message : 'Unknown worker error' },
            })
          )
          markReady()
        }
      )
    },
  })
}

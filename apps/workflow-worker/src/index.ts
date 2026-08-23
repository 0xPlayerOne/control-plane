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

export const serviceName = 'workflow-worker'

export interface WorkflowWorkerStartOptions {
  readonly environment?: RawEnvironment
  readonly logger?: StructuredLogger
  readonly processAdapter?: ProcessAdapter
  readonly traceAdapter?: TraceAdapter
}

export const start = (options: WorkflowWorkerStartOptions = {}) => {
  const logger = options.logger ?? jsonLogger
  return bootstrapService({
    serviceName,
    ...(options.environment === undefined ? {} : { environment: options.environment }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.processAdapter === undefined ? {} : { processAdapter: options.processAdapter }),
    start: async ({ markReady, metadata }) => {
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
        async () => markReady()
      )
    },
  })
}

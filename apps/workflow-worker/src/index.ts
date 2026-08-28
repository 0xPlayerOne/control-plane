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
import {
  createManagedCloudWorkflowWorkerComposition,
  type PostgresConnectionFactory,
} from './cloud-composition.js'
import type { WorkflowRuntimeActivityPort } from './cloud-execution-activities.js'
import type { GraphSegmentActivityPort } from './graph-segment-activity.js'

export const serviceName = 'workflow-worker'

export interface WorkflowWorkerStartOptions {
  readonly environment?: RawEnvironment
  readonly logger?: StructuredLogger
  readonly processAdapter?: ProcessAdapter
  readonly traceAdapter?: TraceAdapter
  readonly restateEndpointFactory?: RestateEndpointFactory
  readonly workflowRuntime?: WorkflowRuntimeActivityPort
  readonly graphActivities?: GraphSegmentActivityPort
  readonly postgresConnectionFactory?: PostgresConnectionFactory
}

export const start = (options: WorkflowWorkerStartOptions = {}) => {
  const logger = options.logger ?? jsonLogger
  return bootstrapService({
    serviceName,
    ...(options.environment === undefined ? {} : { environment: options.environment }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.processAdapter === undefined ? {} : { processAdapter: options.processAdapter }),
    start: async ({ managedCloud, markReady, metadata, registerResource }) => {
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
          const cloudComposition =
            managedCloud === undefined
              ? undefined
              : createManagedCloudWorkflowWorkerComposition(
                  managedCloud,
                  requiredWorkflowRuntime(options.workflowRuntime),
                  options.graphActivities,
                  options.postgresConnectionFactory
                )
          if (cloudComposition !== undefined) {
            registerResource('workflow-worker-postgres', () => cloudComposition.connection.close())
            await cloudComposition.connection.check()
          }
          const factory =
            options.restateEndpointFactory ??
            (metadata.environment === 'test'
              ? {
                  create: async () => ({
                    run: async () => undefined,
                    shutdown: async () => undefined,
                  }),
                }
              : createRestateEndpointFactory({
                  ...(managedCloud?.restate?.role !== 'endpoint'
                    ? {}
                    : {
                        requestIdentityPublicKey: managedCloud.restate.requestIdentityPublicKey,
                      }),
                  ...(cloudComposition === undefined
                    ? {}
                    : { activities: cloudComposition.activities }),
                }))
          const endpoint = await factory.create()
          registerResource('restate-endpoint', () => endpoint.shutdown())
          await endpoint.run()
          markReady()
        }
      )
    },
  })
}

function requiredWorkflowRuntime(
  runtime: WorkflowRuntimeActivityPort | undefined
): WorkflowRuntimeActivityPort {
  if (runtime === undefined) throw new Error('MANAGED_CLOUD_RUNTIME_NOT_CONFIGURED')
  return runtime
}

export { createManagedCloudWorkflowWorkerComposition } from './cloud-composition.js'

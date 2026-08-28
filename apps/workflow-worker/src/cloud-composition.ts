import type { ManagedCloudConfiguration } from '@control-plane/config'
import {
  createPostgresConnection,
  PostgresCommandAcceptanceRepository,
  PostgresExecutionPlanRepository,
  PostgresExecutionRepository,
  type PostgresConnection,
} from '@control-plane/database'
import { CommandInboxService, ExecutionLifecycleService } from '@control-plane/domain'
import { ExecutionPlanAcceptanceValidator } from '@control-plane/execution-plan'
import {
  DurableExecutionLifecycleActivities,
  type WorkflowRuntimeActivityPort,
} from './cloud-execution-activities.js'
import type { GraphSegmentActivityPort } from './graph-segment-activity.js'

export type PostgresConnectionFactory = typeof createPostgresConnection

export interface ManagedCloudWorkflowWorkerComposition {
  readonly connection: PostgresConnection
  readonly activities: DurableExecutionLifecycleActivities
}

export class WorkflowWorkerCloudCompositionError extends Error {
  constructor() {
    super('Managed Cloud workflow worker composition is invalid')
    this.name = 'WorkflowWorkerCloudCompositionError'
  }
}

export class DisabledGraphSegmentActivities implements GraphSegmentActivityPort {
  async runGraphSegment(): Promise<never> {
    throw new Error('GRAPH_EXECUTION_DISABLED')
  }

  async resumeGraphSegment(): Promise<never> {
    throw new Error('GRAPH_EXECUTION_DISABLED')
  }

  async continueGraphSegment(): Promise<never> {
    throw new Error('GRAPH_EXECUTION_DISABLED')
  }
}

export function createManagedCloudWorkflowWorkerComposition(
  configuration: ManagedCloudConfiguration,
  runtime: WorkflowRuntimeActivityPort,
  graph: GraphSegmentActivityPort = new DisabledGraphSegmentActivities(),
  connectionFactory: PostgresConnectionFactory = createPostgresConnection
): ManagedCloudWorkflowWorkerComposition {
  if (
    configuration.service !== 'workflow-worker' ||
    configuration.database === undefined ||
    configuration.restate?.role !== 'endpoint'
  ) {
    throw new WorkflowWorkerCloudCompositionError()
  }
  const connection = connectionFactory(configuration.database)
  const plans = new PostgresExecutionPlanRepository(connection.database)
  return {
    connection,
    activities: new DurableExecutionLifecycleActivities({
      lifecycle: new ExecutionLifecycleService(
        new PostgresExecutionRepository(connection.database)
      ),
      plans,
      runtime,
      graph,
      commands: new CommandInboxService({
        repository: new PostgresCommandAcceptanceRepository(connection.database),
        executionIdFactory: unavailableExecutionIdFactory,
        executionPlanValidator: new ExecutionPlanAcceptanceValidator(plans),
      }),
    }),
  }
}

function unavailableExecutionIdFactory(): never {
  throw new Error('WORKFLOW_WORKER_CANNOT_ACCEPT_EXECUTIONS')
}

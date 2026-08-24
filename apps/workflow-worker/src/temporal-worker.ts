import { NativeConnection, Worker } from '@temporalio/worker'
import { workflowPolicies, type ExecutionLifecycleActivities } from './execution-workflow.js'

export interface TemporalWorkerHandle {
  run(): Promise<void>
  shutdown(): Promise<void>
}

export interface TemporalWorkerFactory {
  create(): Promise<TemporalWorkerHandle>
}

const unavailable = async (): Promise<never> => {
  throw new Error('EXECUTION_ACTIVITY_PORT_NOT_CONFIGURED')
}

export function createTemporalWorkerFactory(options: {
  readonly address: string
  readonly namespace: string
  readonly activities?: ExecutionLifecycleActivities
}): TemporalWorkerFactory {
  return {
    async create() {
      const connection = await NativeConnection.connect({ address: options.address })
      const worker = await Worker.create({
        connection,
        namespace: options.namespace,
        taskQueue: workflowPolicies.taskQueue,
        workflowsPath: new URL('./execution-workflow.js', import.meta.url).pathname,
        activities: options.activities ?? {
          ensureAttempt: unavailable,
          persistStatus: unavailable,
          dispatch: unavailable,
          cleanup: unavailable,
        },
        maxConcurrentActivityTaskExecutions: 32,
        maxConcurrentWorkflowTaskExecutions: 64,
      })
      return {
        run: () => worker.run(),
        shutdown: async () => {
          worker.shutdown()
          await connection.close()
        },
      }
    },
  }
}

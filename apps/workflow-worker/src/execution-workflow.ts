import {
  CancellationScope,
  condition,
  defineSignal,
  isCancellation,
  patched,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow'

export const workflowPolicies = {
  version: 'execution-lifecycle-v1',
  taskQueue: 'control-plane.execution.v1',
  progressPersistence: 'postgres-execution-events',
  activities: {
    retry: { maximumAttempts: 5, initialInterval: '1 second', backoffCoefficient: 2 },
    startToCloseTimeout: '2 minutes',
    heartbeatTimeout: '20 seconds',
  },
} as const

export interface ExecutionWorkflowInput {
  readonly executionId: string
  readonly workflowId: string
  readonly executionPlan: {
    readonly executionPlanId: string
    readonly contentDigest: string
    readonly schemaVersion: number
  }
  readonly deadlineAt: string
}

export interface ExecutionWorkflowResult {
  readonly executionId: string
  readonly attemptId?: string
  readonly status: 'completed' | 'failed' | 'cancelled' | 'timed_out'
  readonly resultReference?: string
}

export interface ExecutionLifecycleActivities {
  ensureAttempt(input: {
    executionId: string
    workflowId: string
    effectKey: string
  }): Promise<{ attemptId: string }>
  persistStatus(input: {
    executionId: string
    attemptId?: string
    state: string
    effectKey: string
  }): Promise<void>
  dispatch(input: {
    executionId: string
    attemptId: string
    executionPlan: ExecutionWorkflowInput['executionPlan']
    effectKey: string
  }): Promise<{ outcome: 'completed' | 'failed'; resultReference?: string }>
  cleanup(input: { executionId: string; attemptId?: string; effectKey: string }): Promise<void>
}

export interface WorkflowControl {
  readonly cancelled?: boolean
  readonly deadlineReached?: boolean
}

export async function runExecutionLifecycle(
  input: ExecutionWorkflowInput,
  activities: ExecutionLifecycleActivities,
  control: WorkflowControl = {}
): Promise<ExecutionWorkflowResult> {
  const key = (operation: string) => `${input.workflowId}:${workflowPolicies.version}:${operation}`
  if (control.cancelled) {
    await activities.persistStatus({
      executionId: input.executionId,
      state: 'cancelled',
      effectKey: key('cancelled'),
    })
    await activities.cleanup({ executionId: input.executionId, effectKey: key('cleanup') })
    return { executionId: input.executionId, status: 'cancelled' }
  }
  if (control.deadlineReached) {
    await activities.persistStatus({
      executionId: input.executionId,
      state: 'timed_out',
      effectKey: key('timed_out'),
    })
    await activities.cleanup({ executionId: input.executionId, effectKey: key('cleanup') })
    return { executionId: input.executionId, status: 'timed_out' }
  }
  await activities.persistStatus({
    executionId: input.executionId,
    state: 'queued',
    effectKey: key('queued'),
  })
  const { attemptId } = await activities.ensureAttempt({
    executionId: input.executionId,
    workflowId: input.workflowId,
    effectKey: key('attempt'),
  })
  await activities.persistStatus({
    executionId: input.executionId,
    attemptId,
    state: 'starting',
    effectKey: key('starting'),
  })
  await activities.persistStatus({
    executionId: input.executionId,
    attemptId,
    state: 'running',
    effectKey: key('running'),
  })
  const dispatched = await activities.dispatch({
    executionId: input.executionId,
    attemptId,
    executionPlan: input.executionPlan,
    effectKey: key('dispatch'),
  })
  const status = dispatched.outcome === 'completed' ? 'completed' : 'failed'
  await activities.persistStatus({
    executionId: input.executionId,
    attemptId,
    state: status,
    effectKey: key(status),
  })
  await activities.cleanup({ executionId: input.executionId, attemptId, effectKey: key('cleanup') })
  return {
    executionId: input.executionId,
    attemptId,
    status,
    ...(dispatched.resultReference ? { resultReference: dispatched.resultReference } : {}),
  }
}

const cancelSignal = defineSignal('cancelExecution')
const temporalActivities = proxyActivities<ExecutionLifecycleActivities>(
  workflowPolicies.activities
)

export async function executionLifecycleWorkflow(
  input: ExecutionWorkflowInput
): Promise<ExecutionWorkflowResult> {
  patched(workflowPolicies.version)
  let cancelled = false
  setHandler(cancelSignal, () => {
    cancelled = true
  })
  const deadlineDelay = Math.max(0, Date.parse(input.deadlineAt) - Date.now())
  const terminalControl = await Promise.race([
    condition(() => cancelled).then(() => ({ cancelled: true })),
    condition(() => false, deadlineDelay).then(() => ({ deadlineReached: true })),
    CancellationScope.cancellable(() => runExecutionLifecycle(input, temporalActivities)),
  ])
  if ('status' in terminalControl) return terminalControl
  try {
    return await runExecutionLifecycle(input, temporalActivities, terminalControl)
  } catch (error) {
    if (!isCancellation(error)) throw error
    return runExecutionLifecycle(input, temporalActivities, { cancelled: true })
  }
}

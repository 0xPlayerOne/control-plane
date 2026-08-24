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
  }): Promise<WorkflowRuntimeOutcome>
  applyInteraction(
    input: WorkflowInteractionResponse & {
      executionId: string
      attemptId: string
      effectKey: string
    }
  ): Promise<WorkflowRuntimeOutcome>
  cleanup(input: { executionId: string; attemptId?: string; effectKey: string }): Promise<void>
}

export interface WorkflowControl {
  readonly cancelled?: boolean
  readonly deadlineReached?: boolean
  readonly waitForInteraction?: (interactionId: string) => Promise<WorkflowInteractionResponse>
}

export interface WorkflowInteractionResponse {
  readonly interactionId: string
  readonly responseId: string
  readonly action: 'approve' | 'deny' | 'input' | 'grant' | 'resume' | 'cancel'
}

export type WorkflowRuntimeOutcome =
  | { readonly outcome: 'completed' | 'failed' | 'cancelled'; readonly resultReference?: string }
  | { readonly outcome: 'awaiting_input'; readonly interactionId: string }

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
  let runtimeOutcome = await activities.dispatch({
    executionId: input.executionId,
    attemptId,
    executionPlan: input.executionPlan,
    effectKey: key('dispatch'),
  })
  while (runtimeOutcome.outcome === 'awaiting_input') {
    const interactionId = runtimeOutcome.interactionId
    await activities.persistStatus({
      executionId: input.executionId,
      attemptId,
      state: 'awaiting_input',
      effectKey: key(`awaiting-input:${interactionId}`),
    })
    if (!control.waitForInteraction) throw new Error('INTERACTION_WAITER_REQUIRED')
    const response = await control.waitForInteraction(interactionId)
    if (response.interactionId !== interactionId) throw new Error('INTERACTION_SIGNAL_MISMATCH')
    runtimeOutcome = await activities.applyInteraction({
      executionId: input.executionId,
      attemptId,
      ...response,
      effectKey: key(`interaction:${interactionId}:${response.responseId}`),
    })
  }
  const status = runtimeOutcome.outcome
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
    ...(runtimeOutcome.resultReference ? { resultReference: runtimeOutcome.resultReference } : {}),
  }
}

const cancelSignal = defineSignal('cancelExecution')
export const interactionResponseSignal =
  defineSignal<[WorkflowInteractionResponse]>('respondToInteraction')
const temporalActivities = proxyActivities<ExecutionLifecycleActivities>(
  workflowPolicies.activities
)

export async function executionLifecycleWorkflow(
  input: ExecutionWorkflowInput
): Promise<ExecutionWorkflowResult> {
  patched(workflowPolicies.version)
  let cancelled = false
  const interactionResponses: WorkflowInteractionResponse[] = []
  setHandler(cancelSignal, () => {
    cancelled = true
  })
  setHandler(interactionResponseSignal, (response) => {
    if (!interactionResponses.some(({ responseId }) => responseId === response.responseId)) {
      interactionResponses.push(response)
    }
  })
  const waitForInteraction = async (interactionId: string) => {
    await condition(() =>
      interactionResponses.some((response) => response.interactionId === interactionId)
    )
    const responseIndex = interactionResponses.findIndex(
      (response) => response.interactionId === interactionId
    )
    const [response] = interactionResponses.splice(responseIndex, 1)
    if (!response) throw new Error('INTERACTION_SIGNAL_MISSING')
    return response
  }
  const deadlineDelay = Math.max(0, Date.parse(input.deadlineAt) - Date.now())
  const terminalControl = await Promise.race([
    condition(() => cancelled).then(() => ({ cancelled: true })),
    condition(() => false, deadlineDelay).then(() => ({ deadlineReached: true })),
    CancellationScope.cancellable(() =>
      runExecutionLifecycle(input, temporalActivities, { waitForInteraction })
    ),
  ])
  if ('status' in terminalControl) return terminalControl
  try {
    return await runExecutionLifecycle(input, temporalActivities, terminalControl)
  } catch (error) {
    if (!isCancellation(error)) throw error
    return runExecutionLifecycle(input, temporalActivities, { cancelled: true })
  }
}

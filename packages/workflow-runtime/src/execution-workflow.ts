import type { ExecutionWorkflowInput } from '@control-plane/orchestration'
import { managedCloudOperationalPolicy } from '@control-plane/config'
import type { GraphActivityOutcome, GraphSegmentActivityPort } from './graph-segment-activity.js'

export const workflowPolicies = {
  version: 'execution-lifecycle-v1',
  graphSegmentVersion: 'execution-graph-segments-v1',
  taskQueue: 'control-plane.execution.v1',
  progressPersistence: 'postgres-execution-events',
  activities: {
    retry: {
      maximumAttempts: managedCloudOperationalPolicy.retry.maximumAttempts,
      initialInterval: `${managedCloudOperationalPolicy.retry.initialDelayMs / 1_000} seconds`,
      backoffCoefficient: managedCloudOperationalPolicy.retry.factor,
    },
    startToCloseTimeout: '2 minutes',
    heartbeatTimeout: '20 seconds',
  },
} as const

export interface ExecutionWorkflowResult {
  readonly executionId: string
  readonly attemptId?: string
  readonly status: 'completed' | 'failed' | 'cancelled' | 'timed_out'
  readonly resultReference?: string
  readonly graphCheckpointId?: string
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
    failure?: { classification: string; code: string }
    resultReference?: string
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
  runGraphSegment: GraphSegmentActivityPort['runGraphSegment']
  resumeGraphSegment: GraphSegmentActivityPort['resumeGraphSegment']
  continueGraphSegment: GraphSegmentActivityPort['continueGraphSegment']
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
  | { readonly outcome: 'completed'; readonly resultReference?: string }
  | { readonly outcome: 'failed'; readonly failureCode: string; readonly retryable: boolean }
  | { readonly outcome: 'cancelled' }
  | { readonly outcome: 'awaiting_input'; readonly interactionId: string }
  | GraphActivityOutcome

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
  let runtimeOutcome: WorkflowRuntimeOutcome
  if (input.graph) {
    runtimeOutcome = await activities.runGraphSegment({
      executionId: input.executionId,
      attemptId,
      workspaceId: input.graph.workspaceId,
      workflowId: input.workflowId,
      graph: input.graph.reference,
      threadId: input.graph.threadId,
      input: input.graph.input,
      idempotencyKey: key('graph:run'),
    })
  } else {
    runtimeOutcome = await activities.dispatch({
      executionId: input.executionId,
      attemptId,
      executionPlan: input.executionPlan,
      effectKey: key('dispatch'),
    })
  }
  while (runtimeOutcome.outcome === 'awaiting_input' || runtimeOutcome.outcome === 'continue') {
    if (runtimeOutcome.outcome === 'continue') {
      if (!input.graph) throw new Error('GRAPH_INPUT_REQUIRED')
      runtimeOutcome = await activities.continueGraphSegment({
        executionId: input.executionId,
        attemptId,
        workspaceId: input.graph.workspaceId,
        workflowId: input.workflowId,
        graph: input.graph.reference,
        threadId: input.graph.threadId,
        checkpointId: runtimeOutcome.checkpointId,
        idempotencyKey: key(`graph:continue:${runtimeOutcome.checkpointId}`),
      })
      continue
    }
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
    if (input.graph) {
      if (!('checkpointId' in runtimeOutcome)) throw new Error('GRAPH_RESUME_ACTIVITY_REQUIRED')
      runtimeOutcome = await activities.resumeGraphSegment({
        executionId: input.executionId,
        attemptId,
        workspaceId: input.graph.workspaceId,
        workflowId: input.workflowId,
        graph: input.graph.reference,
        threadId: input.graph.threadId,
        checkpointId: runtimeOutcome.checkpointId,
        response: { action: response.action, responseId: response.responseId },
        idempotencyKey: key(`graph:resume:${interactionId}:${response.responseId}`),
      })
    } else {
      runtimeOutcome = await activities.applyInteraction({
        executionId: input.executionId,
        attemptId,
        ...response,
        effectKey: key(`interaction:${interactionId}:${response.responseId}`),
      })
    }
  }
  const status = runtimeOutcome.outcome
  await activities.persistStatus({
    executionId: input.executionId,
    attemptId,
    state: status,
    effectKey: key(status),
    ...(status === 'failed'
      ? {
          failure: {
            classification: 'runtime_error',
            code: 'failureCode' in runtimeOutcome ? runtimeOutcome.failureCode : 'RUNTIME_FAILED',
          },
        }
      : {}),
    ...('resultReference' in runtimeOutcome && runtimeOutcome.resultReference
      ? { resultReference: runtimeOutcome.resultReference }
      : {}),
  })
  await activities.cleanup({ executionId: input.executionId, attemptId, effectKey: key('cleanup') })
  return {
    executionId: input.executionId,
    attemptId,
    status,
    ...('resultReference' in runtimeOutcome && runtimeOutcome.resultReference
      ? { resultReference: runtimeOutcome.resultReference }
      : {}),
    ...('checkpointId' in runtimeOutcome && runtimeOutcome.checkpointId
      ? { graphCheckpointId: runtimeOutcome.checkpointId }
      : {}),
  }
}

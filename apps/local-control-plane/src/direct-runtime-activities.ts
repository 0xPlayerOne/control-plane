import { createHash } from 'node:crypto'
import type { JsonValue, ObjectStore, PersistenceProvider } from '@control-plane/deployment'
import type {
  RuntimeExecutionHandle,
  RuntimeExecutionStatus,
  RuntimeAdapterWithTransport,
} from '@control-plane/runtime-sdk'
import type { ExecutionPlanRepository } from '@control-plane/execution-plan'
import type {
  ExecutionLifecycleActivities,
  GraphActivityOutcome,
  WorkflowRuntimeOutcome,
} from '@control-plane/workflow-runtime'

const namespaces = {
  effects: 'workflow-effects',
  handles: 'runtime-handles',
  status: 'workflow-status',
} as const

export class DirectRuntimeExecutionActivities implements ExecutionLifecycleActivities {
  constructor(
    readonly persistence: PersistenceProvider,
    readonly objectStore: ObjectStore,
    readonly runtime: RuntimeAdapterWithTransport,
    readonly plans: ExecutionPlanRepository
  ) {
    if (runtime.transportKind !== 'direct-local') {
      throw new Error('DIRECT_RUNTIME_TRANSPORT_REQUIRED')
    }
  }

  ensureAttempt(input: {
    executionId: string
    workflowId: string
    effectKey: string
  }): Promise<{ attemptId: string }> {
    return this.#effect(input.effectKey, async () => ({
      attemptId: `att_${input.executionId.slice(4)}`,
    }))
  }

  async persistStatus(input: {
    executionId: string
    attemptId?: string
    state: string
    effectKey: string
    failure?: { classification: string; code: string }
    resultReference?: string
  }): Promise<void> {
    await this.#effect(input.effectKey, async () => {
      await this.persistence.transaction(async (transaction) => {
        const id = recordId(input.executionId)
        const existing = await transaction.get(namespaces.status, id)
        await transaction.put({
          namespace: namespaces.status,
          id,
          ...(existing === undefined ? {} : { expectedRevision: existing.revision }),
          value: json(input),
        })
      })
      return { persisted: true }
    })
  }

  dispatch(
    input: Parameters<ExecutionLifecycleActivities['dispatch']>[0]
  ): Promise<WorkflowRuntimeOutcome> {
    return this.#effect(input.effectKey, async () => {
      const executionPlan = await this.plans.get(input.executionPlan)
      if (executionPlan === undefined) {
        return {
          outcome: 'failed',
          failureCode: 'EXECUTION_PLAN_NOT_FOUND',
          retryable: false,
        }
      }
      const handle = await this.runtime.start({
        attemptId: input.attemptId,
        idempotencyKey: input.effectKey,
        executionPlan,
      })
      await this.#saveHandle(input.executionId, handle)
      let interactionId: string | undefined
      for await (const progress of this.runtime.progress(handle)) {
        const candidate = progress.data['interactionId']
        if (progress.type === 'interaction' && typeof candidate === 'string') {
          interactionId = candidate
          break
        }
      }
      const status = await this.runtime.status(handle)
      return this.#outcome(input.executionId, input.attemptId, status, interactionId)
    })
  }

  applyInteraction(input: {
    interactionId: string
    responseId: string
    action: 'approve' | 'deny' | 'input' | 'grant' | 'resume' | 'cancel'
    executionId: string
    attemptId: string
    effectKey: string
  }): Promise<WorkflowRuntimeOutcome> {
    return this.#effect(input.effectKey, async () => {
      const handle = await this.#handle(input.executionId, true)
      let status: RuntimeExecutionStatus
      if (input.action === 'approve' || input.action === 'deny') {
        status = await this.runtime.submitApproval(handle, {
          interactionId: input.interactionId,
          idempotencyKey: input.effectKey,
          decision: input.action,
        })
      } else if (input.action === 'cancel') {
        status = await this.runtime.cancel(handle, {
          idempotencyKey: input.effectKey,
          requestedAt: new Date().toISOString(),
        })
      } else {
        return {
          outcome: 'failed',
          failureCode: 'LOCAL_INTERACTION_PAYLOAD_UNAVAILABLE',
          retryable: false,
        }
      }
      return this.#outcome(input.executionId, input.attemptId, status)
    })
  }

  runGraphSegment(): Promise<GraphActivityOutcome> {
    return Promise.resolve({
      outcome: 'failed',
      failureCode: 'LOCAL_GRAPH_RUNTIME_NOT_CONFIGURED',
      retryable: false,
    })
  }

  resumeGraphSegment(): Promise<GraphActivityOutcome> {
    return this.runGraphSegment()
  }

  continueGraphSegment(): Promise<GraphActivityOutcome> {
    return this.runGraphSegment()
  }

  async cleanup(input: {
    executionId: string
    attemptId?: string
    effectKey: string
  }): Promise<void> {
    await this.#effect(input.effectKey, async () => {
      const handle = await this.#handle(input.executionId, false)
      if (handle !== undefined) await this.runtime.cleanup(handle)
      return { cleaned: true }
    })
  }

  async #outcome(
    executionId: string,
    attemptId: string,
    status: RuntimeExecutionStatus,
    interactionId?: string
  ): Promise<WorkflowRuntimeOutcome> {
    if (status.state === 'completed') {
      const key = `executions/${executionId}/attempts/${attemptId}/result.json`
      await this.objectStore.put({
        key,
        body: new TextEncoder().encode(JSON.stringify(status.result)),
        contentType: 'application/json',
        metadata: { execution: executionId, attempt: attemptId },
      })
      return { outcome: 'completed', resultReference: `object://${key}` }
    }
    if (status.state === 'failed' || status.state === 'timed_out') {
      return {
        outcome: 'failed',
        failureCode: status.error?.code ?? 'RUNTIME_FAILED',
        retryable: status.error?.retryable ?? false,
      }
    }
    if (status.state === 'cancelled') return { outcome: 'cancelled' }
    if (status.state === 'awaiting_input' && interactionId !== undefined) {
      return { outcome: 'awaiting_input', interactionId }
    }
    return {
      outcome: 'failed',
      failureCode: 'RUNTIME_NONTERMINAL_RESULT',
      retryable: true,
    }
  }

  async #saveHandle(executionId: string, handle: RuntimeExecutionHandle): Promise<void> {
    await this.persistence.transaction(async (transaction) => {
      const id = recordId(executionId)
      const current = await transaction.get(namespaces.handles, id)
      if (current === undefined) {
        await transaction.put({ namespace: namespaces.handles, id, value: json(handle) })
      } else if (JSON.stringify(current.value) !== JSON.stringify(handle)) {
        throw new Error('RUNTIME_HANDLE_CONFLICT')
      }
    })
  }

  async #handle(executionId: string, required: true): Promise<RuntimeExecutionHandle>
  async #handle(executionId: string, required: false): Promise<RuntimeExecutionHandle | undefined>
  async #handle(executionId: string, required = true): Promise<RuntimeExecutionHandle | undefined> {
    const handle = await this.persistence.transaction(async (transaction) =>
      transaction.get(namespaces.handles, recordId(executionId))
    )
    if (handle === undefined) {
      if (required) throw new Error('RUNTIME_HANDLE_MISSING')
      return undefined
    }
    return handle.value as unknown as RuntimeExecutionHandle
  }

  async #effect<Result extends JsonValue>(
    effectKey: string,
    operation: () => Promise<Result>
  ): Promise<Result> {
    const id = recordId(effectKey)
    const replay = await this.persistence.transaction(async (transaction) =>
      transaction.get(namespaces.effects, id)
    )
    if (replay !== undefined) return replay.value as Result
    const result = await operation()
    return this.persistence.transaction(async (transaction) => {
      const concurrent = await transaction.get(namespaces.effects, id)
      if (concurrent !== undefined) return concurrent.value as Result
      await transaction.put({ namespace: namespaces.effects, id, value: result })
      return result
    })
  }
}

function recordId(value: string): string {
  return `r-${createHash('sha256').update(value).digest('hex')}`
}

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

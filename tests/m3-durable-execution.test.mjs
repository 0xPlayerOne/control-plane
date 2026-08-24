import { describe, expect, test } from 'bun:test'
import {
  createAgentHqReceiver,
  createDurableExecutionAcceptanceHarness,
  createEventDispatcher,
  createStaleReconciler,
  durableExecutionIds,
} from './support/durable-execution-acceptance.mjs'
import { coreAcceptanceIds } from './support/core-domain-acceptance.mjs'

describe('M3 durable execution acceptance', () => {
  test('runs one authenticated, correlated execution through a mock runtime and survives restart', async () => {
    const harness = await createDurableExecutionAcceptanceHarness()
    const accepted = await harness.accept()
    const apiCrashRecovery = await harness.accept()

    expect(accepted.replayed).toBe(false)
    expect(harness.intent.principal.kind).toBe('agent_hq_service')
    expect(apiCrashRecovery.replayed).toBe(true)
    expect(apiCrashRecovery.execution.executionId).toBe(accepted.execution.executionId)
    expect(harness.commandRepository.executionCount).toBe(1)
    expect(harness.planValidations).toBe(1)
    expect(accepted.execution.executionPlan).toEqual(harness.commandInput().executionPlan)

    const result = await harness.runWorkflow()
    const restartedResult = await harness.runWorkflow()
    const restarted = harness.restartServices()
    const execution = await restarted.lifecycle.getExecution(durableExecutionIds.executionId)
    const attempts = await harness.executionRepository.listAttempts(execution.executionId)
    const events = await harness.eventRepository.queryAfter(execution.executionId, 0, 100)
    const receiver = createAgentHqReceiver()
    const clock = { value: '2026-08-24T16:01:00.000Z' }
    const dispatcher = createEventDispatcher(harness, receiver, clock)

    expect(await dispatcher.dispatchBatch(100)).toEqual({
      delivered: events.length,
      failed: 0,
      quarantined: 0,
    })
    expect(result).toEqual(restartedResult)
    expect(result).toMatchObject({
      executionId: durableExecutionIds.executionId,
      attemptId: durableExecutionIds.attemptId,
      status: 'completed',
      resultReference: durableExecutionIds.resultReference,
    })
    expect(execution).toMatchObject({ state: 'completed', attemptCount: 1 })
    expect(attempts).toHaveLength(1)
    expect(harness.runtime.terminals).toHaveLength(1)
    expect(new Set(events.map(({ eventId }) => eventId)).size).toBe(events.length)
    expect(events.filter(({ type }) => type === 'execution.completed')).toHaveLength(1)
    expect(receiver.accepted.size).toBe(events.length)
    expect(harness.core.dispatches).toBe(0)
    expect([...receiver.accepted.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          executionId: durableExecutionIds.executionId,
          attemptId: durableExecutionIds.attemptId,
          workflowId: durableExecutionIds.workflowId,
          workspaceId: coreAcceptanceIds.workspaceId,
          projectId: coreAcceptanceIds.projectId,
          taskId: coreAcceptanceIds.taskId,
          agentId: coreAcceptanceIds.agentId,
          correlation: expect.objectContaining({
            commandId: coreAcceptanceIds.commandId,
            requestId: coreAcceptanceIds.requestId,
            traceId: coreAcceptanceIds.traceId,
          }),
        }),
      ])
    )
    expect(harness.runtime.family).toBe('mock')
  })

  test('rejects payload conflicts without duplicating the accepted execution', async () => {
    const harness = await createDurableExecutionAcceptanceHarness({ interaction: false })
    await harness.accept()

    await expect(harness.accept({ payloadHash: '5'.repeat(64) })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_PAYLOAD_CONFLICT',
    })
    expect(harness.commandRepository.executionCount).toBe(1)
  })

  test('retries a failed activity with stable effects and tolerates duplicate/out-of-order progress', async () => {
    const harness = await createDurableExecutionAcceptanceHarness({ interaction: false })
    await harness.accept()

    await expect(harness.runWorkflow({ failDispatchOnce: true })).rejects.toThrow(
      'MOCK_TRANSIENT_DISPATCH'
    )
    expect((await harness.runWorkflow()).status).toBe('completed')
    expect(harness.runtime.dispatchFailures).toBe(1)
    expect(harness.runtime.dispatches).toHaveLength(1)
    expect(
      harness.effectResults.has(`${durableExecutionIds.workflowId}:execution-lifecycle-v1:attempt`)
    ).toBe(true)

    expect(
      harness.runtime.emitProgress(durableExecutionIds.attemptId, 2, { phase: 'duplicate' })
    ).toBe(false)
    expect(
      harness.runtime.emitProgress(durableExecutionIds.attemptId, 1, { phase: 'out-of-order' })
    ).toBe(false)
    expect(harness.runtime.progress.get(durableExecutionIds.attemptId)).toEqual([
      { sequence: 1, payload: { phase: 'started' } },
      { sequence: 2, payload: { phase: 'working' } },
    ])
  })

  test('makes cancellation/terminal races and expired interactions deterministic', async () => {
    const harness = await createDurableExecutionAcceptanceHarness({ interaction: false })
    await harness.accept()
    const execution = await harness.lifecycle.getExecution(durableExecutionIds.executionId)
    await harness.lifecycle.transitionExecution({
      executionId: execution.executionId,
      expectedVersion: execution.version,
      to: 'queued',
      transitionedAt: '2026-08-24T16:00:01.000Z',
    })
    const queued = await harness.lifecycle.getExecution(execution.executionId)
    const outcomes = await Promise.allSettled([
      harness.lifecycle.transitionExecution({
        executionId: execution.executionId,
        expectedVersion: queued.version,
        to: 'cancelled',
        transitionedAt: '2026-08-24T16:00:02.000Z',
      }),
      harness.lifecycle.transitionExecution({
        executionId: execution.executionId,
        expectedVersion: queued.version,
        to: 'completed',
        transitionedAt: '2026-08-24T16:00:02.000Z',
        terminalResultRef: durableExecutionIds.resultReference,
      }),
    ])
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1)

    const expiryHarness = await createDurableExecutionAcceptanceHarness({ interaction: true })
    await expiryHarness.accept()
    const acceptedExpiry = await expiryHarness.lifecycle.getExecution(
      durableExecutionIds.executionId
    )
    const attempt = await expiryHarness.lifecycle.createAttempt({
      executionId: acceptedExpiry.executionId,
      attemptId: durableExecutionIds.attemptId,
      expectedExecutionVersion: acceptedExpiry.version,
      queuedAt: '2026-08-24T16:00:02.000Z',
    })
    const interaction = await expiryHarness.interactionService.request({
      interactionId: durableExecutionIds.interactionId,
      executionId: acceptedExpiry.executionId,
      attemptId: attempt.attemptId,
      kind: 'approval',
      prompt: { title: 'Expiring approval' },
      allowedActions: ['approve', 'deny'],
      allowedPrincipalIds: ['svc_agent-hq'],
      requestedAt: '2026-08-24T16:00:03.000Z',
      expiresAt: '2026-08-24T16:00:04.000Z',
    })
    expect(
      await expiryHarness.interactionService.expire(
        interaction.interactionId,
        '2026-08-24T16:00:04.000Z'
      )
    ).toMatchObject({ state: 'expired' })
    await expect(
      expiryHarness.interactionService.respond({
        interactionId: interaction.interactionId,
        executionId: acceptedExpiry.executionId,
        attemptId: attempt.attemptId,
        responseId: durableExecutionIds.responseId,
        action: 'approve',
        respondingPrincipalId: 'svc_agent-hq',
        expectedVersion: 2,
        respondedAt: '2026-08-24T16:00:05.000Z',
      })
    ).rejects.toMatchObject({ code: 'INTERACTION_TERMINAL' })
  })

  test('replays identical retained events after an Agent HQ outage', async () => {
    const harness = await createDurableExecutionAcceptanceHarness({ interaction: false })
    await harness.accept()
    await harness.runWorkflow()
    const receiver = createAgentHqReceiver({ outageCount: 1 })
    const clock = { value: '2026-08-24T16:01:00.000Z' }
    const dispatcher = createEventDispatcher(harness, receiver, clock)
    const events = await harness.eventRepository.queryAfter(durableExecutionIds.executionId, 0, 100)

    const first = await dispatcher.dispatchBatch(100)
    expect(first).toEqual({ delivered: events.length - 1, failed: 1, quarantined: 0 })
    expect(await dispatcher.dispatchBatch(100)).toEqual({ delivered: 0, failed: 0, quarantined: 0 })
    clock.value = '2026-08-24T16:01:01.000Z'
    expect(await dispatcher.dispatchBatch(100)).toEqual({ delivered: 1, failed: 0, quarantined: 0 })
    expect(receiver.attempts).toHaveLength(events.length + 1)
    expect(receiver.attempts[0]).toEqual(receiver.attempts.at(-1))
  })

  test('moves stale work into explicit idempotent reconciliation', async () => {
    const { effects, service } = createStaleReconciler()

    const first = await service.reconcile(durableExecutionIds.executionId)
    const replay = await service.reconcile(durableExecutionIds.executionId)

    expect(first).toEqual(replay)
    expect(first).toMatchObject({
      reason: 'stale_heartbeat',
      action: 'wait_for_runtime',
      state: 'waiting',
      commandId: coreAcceptanceIds.commandId,
      attemptId: durableExecutionIds.attemptId,
      workflowId: durableExecutionIds.workflowId,
      runtimeCommandId: 'mock-command-1',
    })
    expect(effects.map(([kind]) => kind)).toEqual(['mark'])
  })
})

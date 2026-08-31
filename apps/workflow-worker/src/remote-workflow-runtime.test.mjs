import { describe, expect, test } from 'bun:test'
import { InMemoryRuntimeCommandRepository } from '@control-plane/domain'
import { createExecutionPlanTestFixture } from '@control-plane/execution-plan/testing'
import { golden } from '@control-plane/runtime-gateway-protocol/fixtures'
import { DurableRemoteWorkflowRuntime } from './remote-workflow-runtime.js'

describe('durable remote workflow runtime', () => {
  test('queues one attempt-bound command and converges replay on the same outcome', async () => {
    const commands = new InMemoryRuntimeCommandRepository()
    const waits = []
    const runtime = fixture(commands, {
      wait: async (input) => {
        waits.push(input)
        return { outcome: 'completed', resultReference: 'art_01JABCDEF0123456789ABCDEFG' }
      },
    })
    const plan = createExecutionPlanTestFixture()
    const input = {
      executionId: golden.command.executionId,
      attemptId: golden.command.attemptId,
      executionPlan: plan,
      effectKey: 'workflow:dispatch:stable',
    }

    expect(await runtime.dispatch(input)).toEqual({
      outcome: 'completed',
      resultReference: 'art_01JABCDEF0123456789ABCDEFG',
    })
    expect(await runtime.dispatch(input)).toEqual({
      outcome: 'completed',
      resultReference: 'art_01JABCDEF0123456789ABCDEFG',
    })
    expect(await commands.get(golden.command.commandId)).toMatchObject({
      executionId: input.executionId,
      attemptId: input.attemptId,
      nodeId: golden.command.nodeId,
      runtimeConnectionId: golden.command.runtimeConnectionId,
      status: 'queued',
    })
    expect(waits).toHaveLength(2)
    expect(waits[0].command.commandId).toBe(golden.command.commandId)
  })

  test('fails closed before persistence when the command widens frozen attempt scope', async () => {
    const commands = new InMemoryRuntimeCommandRepository()
    const runtime = fixture(commands, { wait: async () => ({ outcome: 'cancelled' }) }, () => ({
      ...golden.command,
      workspaceId: 'wsp_01JBBCDEF0123456789ABCDEFG',
    }))
    const plan = createExecutionPlanTestFixture()

    await expect(
      runtime.dispatch({
        executionId: golden.command.executionId,
        attemptId: golden.command.attemptId,
        executionPlan: plan,
        effectKey: 'workflow:dispatch:stable',
      })
    ).rejects.toThrow('REMOTE_RUNTIME_COMMAND_SCOPE_MISMATCH')
    expect(await commands.get(golden.command.commandId)).toBeUndefined()
  })
})

function fixture(commands, waiter, createExecute = () => golden.command) {
  return new DurableRemoteWorkflowRuntime({
    attempts: {
      getAttempt: async () => ({
        attemptId: golden.command.attemptId,
        executionId: golden.command.executionId,
        runtime: {
          runtimeNodeRefId: golden.command.nodeId,
          runtimeConnectionId: golden.command.runtimeConnectionId,
        },
      }),
    },
    commands,
    factory: { createExecute },
    waiter,
    now: () => new Date('2026-08-25T12:00:00.000Z'),
  })
}

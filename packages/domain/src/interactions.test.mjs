import { describe, expect, test } from 'bun:test'
import { InMemoryInteractionRepository, InteractionError, InteractionService } from './index.ts'

const ids = {
  interactionId: 'int_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  executionId: 'exe_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  attemptId: 'att_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  otherAttemptId: 'att_01ARZ3NDEKTSV4RRFFQ69G5FAW',
  commandId: 'cmd_01ARZ3NDEKTSV4RRFFQ69G5FAV',
}
const requestedAt = '2026-08-24T12:00:00.000Z'
const expiresAt = '2026-08-24T13:00:00.000Z'
const request = (overrides = {}) => ({
  interactionId: ids.interactionId,
  executionId: ids.executionId,
  attemptId: ids.attemptId,
  kind: 'approval',
  prompt: { title: 'Approve write', detailsReference: 'artifact://interaction/details' },
  allowedActions: ['approve', 'deny'],
  allowedPrincipalIds: ['svc_agent-hq'],
  requestedAt,
  expiresAt,
  ...overrides,
})
const response = (overrides = {}) => ({
  interactionId: ids.interactionId,
  executionId: ids.executionId,
  attemptId: ids.attemptId,
  responseId: ids.commandId,
  action: 'approve',
  respondingPrincipalId: 'svc_agent-hq',
  expectedVersion: 1,
  respondedAt: '2026-08-24T12:10:00.000Z',
  ...overrides,
})
function setup() {
  const repository = new InMemoryInteractionRepository()
  return { repository, service: new InteractionService(repository) }
}

describe('durable interactions', () => {
  test('records one authorized response and replays duplicates without repeating effects', async () => {
    const { service } = setup()
    const created = await service.request(request())
    const first = await service.respond(response())
    const duplicate = await service.respond(response())
    expect(created.state).toBe('pending')
    expect(first).toEqual(duplicate)
    expect(first).toMatchObject({ state: 'responded', version: 2, response: { action: 'approve' } })
  })

  test('concurrent duplicate responses converge on the recorded outcome', async () => {
    const { service } = setup()
    await service.request(request())

    const responses = await Promise.all(
      Array.from({ length: 8 }, () => service.respond(response()))
    )

    expect(new Set(responses.map(({ version }) => version))).toEqual(new Set([2]))
    expect(new Set(responses.map(({ response: recorded }) => recorded.responseId))).toEqual(
      new Set([ids.commandId])
    )
  })

  test('supports denial, structured input, permission, resume, and cancellation', async () => {
    for (const [kind, action, value] of [
      ['approval', 'deny', undefined],
      ['input', 'input', { answer: 'bounded' }],
      ['permission', 'grant', undefined],
      ['resume', 'resume', undefined],
      ['cancel', 'cancel', undefined],
    ]) {
      const { service } = setup()
      await service.request(request({ kind, allowedActions: [action] }))
      const result = await service.respond(response({ action, ...(value ? { value } : {}) }))
      expect(result).toMatchObject({ response: { action } })
    }
  })

  test('rejects non-JSON input and actions that do not match the interaction kind', async () => {
    const { service } = setup()

    await expect(
      service.request(request({ kind: 'permission', allowedActions: ['resume'] }))
    ).rejects.toMatchObject({ name: 'ZodError' })
    await service.request(request({ kind: 'input', allowedActions: ['input'] }))
    await expect(
      service.respond(response({ action: 'input', value: { answer: 1n } }))
    ).rejects.toMatchObject({ name: 'ZodError' })
  })

  test('rejects expired, stale, wrong-attempt, conflicting, and unauthorized responses', async () => {
    const { service } = setup()
    await service.request(request())
    for (const [overrides, code] of [
      [{ respondingPrincipalId: 'svc_other' }, 'UNAUTHORIZED_INTERACTION_RESPONSE'],
      [{ attemptId: ids.otherAttemptId }, 'WRONG_INTERACTION_ATTEMPT'],
      [{ expectedVersion: 2 }, 'STALE_INTERACTION_VERSION'],
      [{ respondedAt: expiresAt }, 'INTERACTION_EXPIRED'],
      [{ respondedAt: '2026-08-24T13:00:00.001Z' }, 'INTERACTION_EXPIRED'],
    ])
      await expect(service.respond(response(overrides))).rejects.toMatchObject({ code })
    await service.respond(response())
    await expect(service.respond(response({ action: 'deny' }))).rejects.toMatchObject({
      code: 'INTERACTION_RESPONSE_CONFLICT',
    })
  })

  test('terminal execution result wins deterministically over later cancellation', async () => {
    const { service } = setup()
    await service.request(request({ kind: 'cancel', allowedActions: ['cancel'] }))
    const resolved = await service.resolveTerminal(ids.interactionId, '2026-08-24T12:05:00.000Z')
    expect(resolved.state).toBe('cancelled')
    await expect(
      service.respond(response({ action: 'cancel', respondedAt: '2026-08-24T12:06:00.000Z' }))
    ).rejects.toBeInstanceOf(InteractionError)
  })

  test('expires pending interactions deterministically across restart and replay', async () => {
    const { repository, service } = setup()
    await service.request(request())
    const restarted = new InteractionService(repository)
    expect((await restarted.expire(ids.interactionId, expiresAt)).state).toBe('expired')
    expect((await restarted.expire(ids.interactionId, '2026-08-24T13:00:00.002Z')).state).toBe(
      'expired'
    )
  })
})

import { describe, expect, test } from 'bun:test'
import {
  createDeterministicIdGenerator,
  createFixedClock,
  createRecordingAdapter,
  withTestApplication,
} from './index.ts'

describe('shared test helpers', () => {
  test('generates deterministic, independent identifier sequences', () => {
    const first = createDeterministicIdGenerator('execution')
    const second = createDeterministicIdGenerator('execution')

    expect([first(), first(), second()]).toEqual([
      'execution-0001',
      'execution-0002',
      'execution-0001',
    ])
  })

  test('returns fresh dates from a fixed clock', () => {
    const clock = createFixedClock('2026-08-23T12:00:00.000Z')

    const first = clock.now()
    const second = clock.now()
    first.setUTCFullYear(2000)

    expect(second.toISOString()).toBe('2026-08-23T12:00:00.000Z')
  })

  test('records adapter inputs as snapshots while returning fake results', async () => {
    const adapter = createRecordingAdapter(async ({ value }) => value.toUpperCase())
    const input = { value: 'ready' }

    await expect(adapter.invoke(input)).resolves.toBe('READY')
    input.value = 'mutated'

    expect(adapter.calls).toEqual([{ value: 'ready' }])
  })

  test('always closes HTTP test applications', async () => {
    let closed = false
    const application = {
      close: async () => {
        closed = true
      },
      inject: async () => ({ statusCode: 200 }),
    }

    await expect(
      withTestApplication(
        async () => application,
        async (created) => {
          expect(await created.inject()).toEqual({ statusCode: 200 })
          throw new Error('test failure')
        }
      )
    ).rejects.toThrow('test failure')
    expect(closed).toBe(true)
  })
})

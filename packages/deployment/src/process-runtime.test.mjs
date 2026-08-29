import { describe, expect, test } from 'bun:test'
import { execPath } from 'node:process'
import { NodeProcessRuntimeProvider } from './process-runtime.ts'

describe('NodeProcessRuntimeProvider', () => {
  test('launches without a shell and stops only the owned child', async () => {
    const provider = new NodeProcessRuntimeProvider({ stopTimeoutMs: 2_000 })
    const handle = await provider.launch({
      executable: execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      environment: { CONTROL_PLANE_PROCESS_TEST: 'true' },
    })
    expect(handle.pid).toBeGreaterThan(0)
    await handle.stop()
    expect(await handle.wait()).toBeGreaterThanOrEqual(0)
  })

  test('rejects malformed launch arguments before spawning', async () => {
    const provider = new NodeProcessRuntimeProvider()
    await expect(provider.launch({ executable: '', args: [] })).rejects.toMatchObject({
      code: 'PROCESS_LAUNCH_INVALID',
    })
  })
})

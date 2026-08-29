import { describe, expect, test } from 'bun:test'
import { CLOUD_RUNTIME_DISABLED_FAILURE, DisabledCloudRuntime } from './cloud-disabled-runtime.ts'

describe('disabled Cloud runtime', () => {
  test('fails execution and interaction deterministically without retry', async () => {
    const runtime = new DisabledCloudRuntime()
    const failure = {
      outcome: 'failed',
      failureCode: CLOUD_RUNTIME_DISABLED_FAILURE,
      retryable: false,
    }

    expect(await runtime.dispatch()).toEqual(failure)
    expect(await runtime.applyInteraction()).toEqual(failure)
    await expect(runtime.cleanup()).resolves.toBeUndefined()
  })
})

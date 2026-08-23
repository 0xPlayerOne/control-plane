import { describe, expect, test } from 'bun:test'
import { start } from './index.ts'

class FakeProcessAdapter {
  listeners = new Map()
  on(event, listener) {
    this.listeners.set(event, listener)
  }
  off(event) {
    this.listeners.delete(event)
  }
  setExitCode() {}
}

describe('workflow worker telemetry', () => {
  test('emits a correlated initialization span through an injectable adapter', async () => {
    const spans = []
    const logs = []
    const runtime = await start({
      environment: {
        APP_ENV: 'test',
        COMMIT_SHA: 'abc123',
        INSTANCE_ID: 'worker-1',
        SERVICE_VERSION: '1.0.0',
      },
      logger: { write: (entry) => logs.push(entry) },
      processAdapter: new FakeProcessAdapter(),
      traceAdapter: {
        startSpan(input) {
          spans.push(input)
          return { context: undefined, end: () => undefined }
        },
      },
    })

    expect(runtime.readiness().status).toBe('ready')
    expect(spans).toEqual([
      expect.objectContaining({
        name: 'service.worker.initialize',
        attributes: expect.objectContaining({
          'service.name': 'workflow-worker',
          'control.correlation_id': 'worker-1',
        }),
      }),
    ])
    expect(logs).toContainEqual(
      expect.objectContaining({
        event: 'service.started',
        metadata: expect.objectContaining({ instanceId: 'worker-1' }),
      })
    )
    await runtime.shutdown('test-complete')
  })
})

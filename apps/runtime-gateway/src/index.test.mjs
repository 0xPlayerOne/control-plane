import { describe, expect, test } from 'bun:test'
import { start } from './index.js'

class FakeProcessAdapter {
  listeners = new Map()
  exitCode

  on(event, listener) {
    this.listeners.set(event, listener)
  }

  off(event, listener) {
    if (this.listeners.get(event) === listener) this.listeners.delete(event)
  }

  setExitCode(code) {
    this.exitCode = code
  }
}

const productionEnvironment = {
  APP_ENV: 'production',
  COMMIT_SHA: 'runtime-gateway-startup-test',
  INSTANCE_ID: 'runtime-gateway-production-test',
  SERVICE_VERSION: '1.3.0',
}

describe('Runtime Gateway production startup', () => {
  test('fails closed when no WebSocket server composition is provided', async () => {
    const processAdapter = new FakeProcessAdapter()

    await expect(
      start({
        environment: productionEnvironment,
        logger: { write: () => undefined },
        processAdapter,
      })
    ).rejects.toMatchObject({ name: 'ServiceStartupError' })

    expect(processAdapter.exitCode).toBe(1)
    expect(processAdapter.listeners.size).toBe(0)
  })

  test('starts and drains an injected production WebSocket server', async () => {
    const processAdapter = new FakeProcessAdapter()
    let starts = 0
    let closes = 0
    const runtime = await start({
      environment: productionEnvironment,
      logger: { write: () => undefined },
      processAdapter,
      webSocketServer: {
        start: () => starts++,
        close: async () => {
          closes++
        },
      },
    })

    expect(starts).toBe(1)
    expect(runtime.readiness().status).toBe('ready')
    await runtime.shutdown('test')
    expect(closes).toBe(1)
    expect(processAdapter.listeners.size).toBe(0)
  })
})

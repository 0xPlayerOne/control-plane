import { describe, expect, test } from 'bun:test'
import { bootstrapService, HEALTH_PATH, READY_PATH } from './index.ts'

class FakeProcessAdapter {
  exitCode = undefined
  listeners = new Map()

  on(event, listener) {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
  }

  off(event, listener) {
    this.listeners.get(event)?.delete(listener)
  }

  setExitCode(code) {
    this.exitCode = code
  }

  async emit(event, value) {
    await Promise.all([...(this.listeners.get(event) ?? [])].map((listener) => listener(value)))
  }
}

const productionEnvironment = {
  APP_ENV: 'production',
  SERVICE_VERSION: '1.2.3',
  COMMIT_SHA: 'abc123',
  INSTANCE_ID: 'instance-1',
  CONTROL_API_PORT: '4000',
  API_TOKEN: 'must-never-appear',
}

describe('bootstrapService', () => {
  test('exposes health and readiness conventions without secrets', async () => {
    const logs = []
    const runtime = await bootstrapService({
      serviceName: 'control-api',
      environment: productionEnvironment,
      logger: { write: (entry) => logs.push(entry) },
      processAdapter: new FakeProcessAdapter(),
      start: async ({ markReady }) => markReady(),
    })

    expect(HEALTH_PATH).toBe('/health')
    expect(READY_PATH).toBe('/ready')
    expect(runtime.health()).toEqual({ status: 'ok', metadata: runtime.metadata })
    expect(runtime.readiness()).toEqual({ status: 'ready', metadata: runtime.metadata })
    expect(
      JSON.stringify({ health: runtime.health(), ready: runtime.readiness(), logs })
    ).not.toContain('must-never-appear')

    await runtime.shutdown('test-complete')
  })

  test('closes registered resources in reverse order before completing shutdown', async () => {
    const closed = []
    const runtime = await bootstrapService({
      serviceName: 'workflow-worker',
      environment: {
        APP_ENV: 'test',
        SERVICE_VERSION: '1.2.3',
        COMMIT_SHA: 'abc123',
        INSTANCE_ID: 'worker-1',
      },
      processAdapter: new FakeProcessAdapter(),
      start: async ({ markReady, registerResource }) => {
        registerResource('database', async () => closed.push('database'))
        registerResource('queue', async () => closed.push('queue'))
        markReady()
      },
    })

    await runtime.shutdown('SIGTERM')
    await runtime.shutdown('duplicate')

    expect(closed).toEqual(['queue', 'database'])
    expect(runtime.readiness().status).toBe('not_ready')
  })

  test('handles termination signals through graceful shutdown', async () => {
    const processAdapter = new FakeProcessAdapter()
    const closed = []
    const runtime = await bootstrapService({
      serviceName: 'runtime-worker',
      environment: {
        APP_ENV: 'test',
        SERVICE_VERSION: '1.2.3',
        COMMIT_SHA: 'abc123',
        INSTANCE_ID: 'worker-1',
      },
      processAdapter,
      start: async ({ registerResource }) => {
        registerResource('runtime', async () => closed.push('runtime'))
      },
    })

    await processAdapter.emit('SIGINT')

    expect(closed).toEqual(['runtime'])
    expect(processAdapter.exitCode).toBe(0)
    expect(runtime.readiness().status).toBe('not_ready')
  })

  test('redacts fatal errors, shuts down, and marks the process failed', async () => {
    const processAdapter = new FakeProcessAdapter()
    const logs = []
    const closed = []
    await bootstrapService({
      serviceName: 'tool-gateway',
      environment: {
        APP_ENV: 'test',
        SERVICE_VERSION: '1.2.3',
        COMMIT_SHA: 'abc123',
        INSTANCE_ID: 'gateway-1',
      },
      logger: { write: (entry) => logs.push(entry) },
      processAdapter,
      start: async ({ registerResource }) => {
        registerResource('server', async () => closed.push('server'))
        throw new Error('startup failed with token=super-secret')
      },
    }).catch(() => undefined)

    expect(closed).toEqual(['server'])
    expect(processAdapter.exitCode).toBe(1)
    expect(JSON.stringify(logs)).not.toContain('super-secret')
  })
})

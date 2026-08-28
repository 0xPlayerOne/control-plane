import { describe, expect, test } from 'bun:test'
import { loadManagedCloudConfiguration } from '@control-plane/config'
import { DurableExecutionLifecycleActivities } from './cloud-execution-activities.ts'
import { createManagedCloudWorkflowWorkerComposition, start } from './index.ts'

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
    const endpoint = { run: async () => undefined, shutdown: async () => undefined }
    const runtime = await start({
      restateEndpointFactory: { create: async () => endpoint },
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

  test('composes durable activities from the managed Cloud Neon boundary', () => {
    const composition = createManagedCloudWorkflowWorkerComposition(
      loadManagedCloudConfiguration(managedCloudEnvironment(), 'workflow-worker'),
      runtimePort(),
      undefined,
      () => ({ database: {}, check: async () => undefined, close: async () => undefined })
    )

    expect(composition.activities).toBeInstanceOf(DurableExecutionLifecycleActivities)
  })

  test('probes and closes Neon around managed Cloud worker startup', async () => {
    const processAdapter = new FakeProcessAdapter()
    const lifecycle = []
    const endpoint = {
      run: async () => undefined,
      shutdown: async () => lifecycle.push('endpoint'),
    }
    const runtime = await start({
      environment: managedCloudEnvironment(),
      logger: { write: () => undefined },
      processAdapter,
      workflowRuntime: runtimePort(),
      restateEndpointFactory: { create: async () => endpoint },
      postgresConnectionFactory: () => ({
        database: {},
        check: async () => lifecycle.push('checked'),
        close: async () => lifecycle.push('postgres'),
      }),
    })

    expect(lifecycle).toEqual(['checked'])
    expect(runtime.readiness().status).toBe('ready')
    await runtime.shutdown('test-complete')
    expect(lifecycle).toEqual(['checked', 'endpoint', 'postgres'])
  })

  test('fails managed Cloud startup before accepting workflows without a runtime port', async () => {
    const calls = []
    await expect(
      start({
        environment: managedCloudEnvironment(),
        logger: { write: () => undefined },
        processAdapter: new FakeProcessAdapter(),
        restateEndpointFactory: {
          create: async () => {
            calls.push('endpoint')
            return { run: async () => undefined, shutdown: async () => undefined }
          },
        },
        postgresConnectionFactory: () => {
          calls.push('postgres')
          return { database: {}, check: async () => undefined, close: async () => undefined }
        },
      })
    ).rejects.toThrow('Service startup failed')
    expect(calls).toEqual([])
  })
})

function runtimePort() {
  return {
    dispatch: async () => ({ outcome: 'failed', failureCode: 'TEST', retryable: false }),
    applyInteraction: async () => ({ outcome: 'failed', failureCode: 'TEST', retryable: false }),
    cleanup: async () => undefined,
  }
}

function managedCloudEnvironment() {
  return {
    APP_ENV: 'staging',
    COMMIT_SHA: 'abc123',
    INSTANCE_ID: 'worker-1',
    SERVICE_VERSION: '1.0.0',
    DATABASE_URL:
      'postgresql://app:database-secret@example.neon.tech/control_plane?sslmode=require',
    CONTROL_PLANE_SECRET_ENCRYPTION_KEY:
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    RESTATE_REQUEST_IDENTITY_PUBLIC_KEY: 'publickeyv1_w7YHemBctH5Ck2nQRQ47iBBqhNHy4FV7t2Usbye2A6f',
    R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
    R2_BUCKET: 'ctrl-plane',
    R2_REGION: 'auto',
    R2_ACCESS_KEY_ID: 'access-key',
    R2_SECRET_ACCESS_KEY: 'secret-key-that-is-not-logged',
  }
}

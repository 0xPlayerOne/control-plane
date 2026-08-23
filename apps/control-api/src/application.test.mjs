import { afterEach, describe, expect, test } from 'bun:test'
import { createControlApiApplication, createOpenApiDocument } from './application.ts'
import { start } from './index.ts'

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

const metadata = {
  serviceName: 'control-api',
  version: '1.4.0',
  commitSha: 'abc123',
  environment: 'test',
  instanceId: 'control-api-test',
}
const applications = []

async function createApplication(logs = []) {
  const application = await createControlApiApplication({
    health: () => ({ status: 'ok', metadata }),
    logger: { write: (entry) => logs.push(entry) },
    metadata,
    readiness: () => ({ status: 'ready', metadata }),
  })
  applications.push(application)
  return application
}

afterEach(async () => {
  await Promise.all(applications.splice(0).map((application) => application.close()))
})

describe('Control API', () => {
  test('exposes health, readiness, and security headers', async () => {
    const application = await createApplication()

    const health = await application.inject({ method: 'GET', url: '/health' })
    const ready = await application.inject({ method: 'GET', url: '/ready' })

    expect(health.statusCode).toBe(200)
    expect(health.json()).toEqual({ status: 'ok', metadata })
    expect(ready.json()).toEqual({ status: 'ready', metadata })
    expect(health.headers['x-content-type-options']).toBe('nosniff')
    expect(health.headers['x-request-id']).toBeString()
    expect(health.headers['x-correlation-id']).toBeString()
  })

  test('serves a versioned endpoint and propagates request context through responses and logs', async () => {
    const logs = []
    const application = await createApplication(logs)

    const response = await application.inject({
      method: 'GET',
      url: '/v1/system/echo?message=hello',
      headers: {
        'x-correlation-id': 'correlation-123',
        'x-request-id': 'request-123',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['x-request-id']).toBe('request-123')
    expect(response.headers['x-correlation-id']).toBe('correlation-123')
    expect(response.json()).toEqual({
      data: { message: 'hello' },
      meta: { correlationId: 'correlation-123', requestId: 'request-123' },
    })
    expect(logs).toContainEqual(
      expect.objectContaining({
        event: 'http.request.completed',
        details: expect.objectContaining({
          correlationId: 'correlation-123',
          requestId: 'request-123',
          statusCode: 200,
        }),
      })
    )
  })

  test('replaces unsafe external context identifiers', async () => {
    const application = await createApplication()

    const response = await application.inject({
      method: 'GET',
      url: '/v1/system/echo?message=hello',
      headers: {
        'x-correlation-id': 'unsafe correlation id',
        'x-request-id': 'unsafe request id',
      },
    })

    expect(response.headers['x-request-id']).not.toBe('unsafe request id')
    expect(response.headers['x-correlation-id']).toBe(response.headers['x-request-id'])
  })

  test('normalizes validation and not-found errors without exposing internals', async () => {
    const application = await createApplication()

    const validation = await application.inject({ method: 'GET', url: '/v1/system/echo' })
    const notFound = await application.inject({ method: 'GET', url: '/v1/unknown' })

    expect(validation.statusCode).toBe(400)
    expect(validation.json()).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        details: [expect.objectContaining({ field: 'message' })],
        message: 'Request validation failed',
      },
      meta: {
        correlationId: validation.headers['x-correlation-id'],
        requestId: validation.headers['x-request-id'],
      },
    })
    expect(notFound.statusCode).toBe(404)
    expect(notFound.json().error).toEqual({ code: 'NOT_FOUND', message: 'Resource not found' })
    expect(JSON.stringify(notFound.json())).not.toContain('stack')
  })

  test('keeps service authentication fail-closed behind an explicit extension point', async () => {
    const application = await createApplication()

    const response = await application.inject({ method: 'GET', url: '/v1/system/authenticated' })

    expect(response.statusCode).toBe(503)
    expect(response.json().error.code).toBe('SERVICE_AUTH_NOT_CONFIGURED')
  })

  test('generates versioned OpenAPI paths', async () => {
    const application = await createApplication()

    const document = createOpenApiDocument(application)

    expect(document.openapi).toStartWith('3.')
    expect(document.paths).toHaveProperty('/v1/system/echo')
    expect(document.paths).toHaveProperty('/health')
    expect(document.components?.securitySchemes).toHaveProperty('service-bearer')
  })

  test('closes the Fastify application through shared graceful shutdown', async () => {
    const processAdapter = new FakeProcessAdapter()
    const started = await start({
      environment: {
        APP_ENV: 'test',
        COMMIT_SHA: 'abc123',
        CONTROL_API_PORT: '3000',
        INSTANCE_ID: 'control-api-test',
        SERVICE_VERSION: '1.4.0',
      },
      listen: false,
      logger: { write: () => undefined },
      processAdapter,
    })
    await processAdapter.emit('SIGTERM')

    await expect(started.application.inject('/health')).rejects.toThrow('already been closed')
    expect(processAdapter.exitCode).toBe(0)
    expect(started.runtime.readiness().status).toBe('not_ready')
  })
})

import { afterEach, describe, expect, test } from 'bun:test'
import { withTestApplication } from '@control-plane/testing'
import { createControlApiApplication, createOpenApiDocument } from './application.ts'
import {
  PolicyServiceAuthenticator,
  createInternalServicePrincipal,
} from './auth/service-authentication.ts'
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

async function createApplication(logs = [], serviceAuthenticator) {
  const application = await createControlApiApplication({
    health: () => ({ status: 'ok', metadata }),
    logger: { write: (entry) => logs.push(entry) },
    metadata,
    readiness: () => ({ status: 'ready', metadata }),
    serviceAuthenticator,
  })
  applications.push(application)
  return application
}

afterEach(async () => {
  await Promise.all(applications.splice(0).map((application) => application.close()))
})

describe('Control API', () => {
  test('exposes health, readiness, and security headers', async () => {
    await withTestApplication(createApplication, async (application) => {
      const health = await application.inject({ method: 'GET', url: '/health' })
      const ready = await application.inject({ method: 'GET', url: '/ready' })

      expect(health.statusCode).toBe(200)
      expect(health.json()).toEqual({ status: 'ok', metadata })
      expect(ready.json()).toEqual({ status: 'ready', metadata })
      expect(health.headers['x-content-type-options']).toBe('nosniff')
      expect(health.headers['x-request-id']).toBeString()
      expect(health.headers['x-correlation-id']).toBeString()
    })
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

  test('propagates valid W3C trace context through the HTTP boundary', async () => {
    const logs = []
    const application = await createApplication(logs)
    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'

    const response = await application.inject({
      method: 'GET',
      url: '/v1/system/echo?message=hello',
      headers: { traceparent },
    })

    expect(response.headers.traceparent).toBe(traceparent)
    expect(logs).toContainEqual(
      expect.objectContaining({
        event: 'http.request.completed',
        details: expect.objectContaining({ traceId: '4bf92f3577b34da6a3ce929d0e0e4736' }),
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

    const response = await application.inject({
      method: 'POST',
      url: '/v1/system/authenticated',
      payload: scopedRequest(),
    })

    expect(response.statusCode).toBe(503)
    expect(response.json().error.code).toBe('SERVICE_AUTH_NOT_CONFIGURED')
  })

  test('authenticates an Agent HQ service principal and enforces envelope scope', async () => {
    const logs = []
    const claims = validServiceClaims()
    const authenticator = policyAuthenticator({ claims, logs })
    const application = await createApplication(logs, authenticator)

    const response = await application.inject({
      method: 'POST',
      url: '/v1/system/authenticated',
      headers: { authorization: 'Bearer valid-agent-hq-token' },
      payload: scopedRequest(),
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().data).toEqual({
      authenticated: true,
      principalId: 'svc_agent-hq',
    })
    expect(logs).toContainEqual(
      expect.objectContaining({
        event: 'service_auth.succeeded',
        details: expect.objectContaining({ principalId: 'svc_agent-hq' }),
      })
    )
  })

  test('rejects user, device, and provider credential classes', async () => {
    for (const credentialKind of ['browser_session', 'runtime_device', 'provider']) {
      const application = await createApplication(
        [],
        policyAuthenticator({ claims: { ...validServiceClaims(), credentialKind } })
      )
      const response = await authenticatedRequest(application, `secret-${credentialKind}`)

      expect(response.statusCode).toBe(401)
      expect(response.json().error.code).toBe('SERVICE_CREDENTIAL_CLASS_REJECTED')
    }
  })

  test('normalizes missing credentials and invalid versioned envelopes', async () => {
    const application = await createApplication(
      [],
      policyAuthenticator({ claims: validServiceClaims() })
    )
    const missingCredential = await application.inject({
      method: 'POST',
      url: '/v1/system/authenticated',
      payload: scopedRequest(),
    })
    const invalidEnvelope = await application.inject({
      method: 'POST',
      url: '/v1/system/authenticated',
      headers: { authorization: 'Bearer valid-agent-hq-token' },
      payload: { caller: { servicePrincipalId: 'svc_agent-hq' } },
    })

    expect(missingCredential.statusCode).toBe(401)
    expect(missingCredential.json().error.code).toBe('SERVICE_CREDENTIAL_REQUIRED')
    expect(invalidEnvelope.statusCode).toBe(400)
    expect(invalidEnvelope.json().error.code).toBe('SERVICE_REQUEST_ENVELOPE_INVALID')
  })

  test('fails closed for malformed, wrong-audience, expired, revoked, and scope-conflicting credentials', async () => {
    const cases = [
      {
        authenticator: (logs) =>
          policyAuthenticator({ logs, verifierError: new Error('invalid signature') }),
        code: 'SERVICE_CREDENTIAL_MALFORMED',
        token: 'raw-malformed-secret',
      },
      {
        authenticator: (logs) =>
          policyAuthenticator({
            claims: { ...validServiceClaims(), audience: 'runtime-node' },
            logs,
          }),
        code: 'SERVICE_CREDENTIAL_INVALID_AUDIENCE',
        token: 'raw-wrong-audience-secret',
      },
      {
        authenticator: (logs) =>
          policyAuthenticator({
            claims: { ...validServiceClaims(), issuer: 'https://untrusted.example' },
            logs,
          }),
        code: 'SERVICE_CREDENTIAL_INVALID_ISSUER',
        token: 'raw-wrong-issuer-secret',
      },
      {
        authenticator: (logs) =>
          policyAuthenticator({
            claims: {
              ...validServiceClaims(),
              expiresAt: '2026-08-23T11:59:29.000Z',
              issuedAt: '2026-08-23T11:00:00.000Z',
            },
            logs,
          }),
        code: 'SERVICE_CREDENTIAL_EXPIRED',
        token: 'raw-expired-secret',
      },
      {
        authenticator: (logs) =>
          policyAuthenticator({ claims: validServiceClaims(), logs, revoked: true }),
        code: 'SERVICE_CREDENTIAL_REVOKED',
        token: 'raw-revoked-secret',
      },
      {
        authenticator: (logs) =>
          policyAuthenticator({
            claims: {
              ...validServiceClaims(),
              workspaceIds: ['wsp_01JBBCDEF0123456789ABCDEFG'],
            },
            logs,
          }),
        code: 'SERVICE_CREDENTIAL_SCOPE_MISMATCH',
        token: 'raw-scope-secret',
      },
      {
        authenticator: (logs) => policyAuthenticator({ claims: validServiceClaims(), logs }),
        code: 'SERVICE_CREDENTIAL_SCOPE_MISMATCH',
        request: {
          ...scopedRequest(),
          caller: { servicePrincipalId: 'svc_another-caller' },
        },
        token: 'raw-caller-secret',
      },
      {
        authenticator: (logs) =>
          policyAuthenticator({
            claims: { ...validServiceClaims(), scopes: ['runtime:read'] },
            logs,
          }),
        code: 'SERVICE_CREDENTIAL_SCOPE_MISMATCH',
        token: 'raw-operation-scope-secret',
      },
    ]

    for (const testCase of cases) {
      const logs = []
      const application = await createApplication(logs, testCase.authenticator(logs))
      const response = await authenticatedRequest(application, testCase.token, testCase.request)

      expect(response.statusCode).toBe(testCase.code.endsWith('SCOPE_MISMATCH') ? 403 : 401)
      expect(response.json().error.code).toBe(testCase.code)
      expect(JSON.stringify(logs)).not.toContain(testCase.token)
      expect(JSON.stringify(response.json())).not.toContain(testCase.token)
    }
  })

  test('requires explicit least-privilege scopes for internal service principals', () => {
    expect(() =>
      createInternalServicePrincipal({ principalId: 'svc_worker', scopes: [] })
    ).toThrow()
    expect(() =>
      createInternalServicePrincipal({ principalId: 'svc_worker', scopes: ['*'] })
    ).toThrow()
    expect(
      createInternalServicePrincipal({
        principalId: 'svc_worker',
        scopes: ['execution:dispatch'],
      })
    ).toEqual({
      kind: 'internal_service',
      principalId: 'svc_worker',
      projectIds: [],
      scopes: ['execution:dispatch'],
      workspaceIds: [],
    })
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

function validServiceClaims() {
  return {
    audience: 'control-plane',
    credentialId: 'credential-agent-hq-2026-08',
    credentialKind: 'service',
    expiresAt: '2026-08-23T13:00:00.000Z',
    issuedAt: '2026-08-23T12:00:00.000Z',
    issuer: 'https://agent-hq.example',
    keyId: 'agent-hq-2026-08',
    principalId: 'svc_agent-hq',
    projectIds: ['prj_01JABCDEF0123456789ABCDEFG'],
    scopes: ['system:authenticate'],
    workspaceIds: ['wsp_01JABCDEF0123456789ABCDEFG'],
  }
}

function scopedRequest() {
  return {
    caller: { servicePrincipalId: 'svc_agent-hq' },
    contractVersion: { major: 1, minor: 0 },
    correlation: { traceId: 'trc_01JABCDEF0123456789ABCDEFG' },
    operation: 'runtime.list',
    parameters: {},
    projectId: 'prj_01JABCDEF0123456789ABCDEFG',
    requestId: 'req_01JABCDEF0123456789ABCDEFG',
    requestedAt: '2026-08-23T12:00:00.000Z',
    workspaceId: 'wsp_01JABCDEF0123456789ABCDEFG',
  }
}

function authenticatedRequest(application, token, payload = scopedRequest()) {
  return application.inject({
    method: 'POST',
    url: '/v1/system/authenticated',
    headers: { authorization: `Bearer ${token}` },
    payload,
  })
}

function policyAuthenticator({ claims, logs = [], revoked = false, verifierError } = {}) {
  return new PolicyServiceAuthenticator({
    audience: 'control-plane',
    clockSkewMs: 30_000,
    issuer: 'https://agent-hq.example',
    logger: { write: (entry) => logs.push(entry) },
    now: () => new Date('2026-08-23T12:00:00.000Z'),
    revocationChecker: { isRevoked: async () => revoked },
    verifier: {
      verify: async () => {
        if (verifierError) throw verifierError
        return claims
      },
    },
  })
}

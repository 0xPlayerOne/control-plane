import { afterEach, describe, expect, test } from 'bun:test'
import { contextPackageSerializationFixtures } from '@control-plane/context'
import { ControlApiFixtures } from '@control-plane/contracts'
import { executionConstraintFixtures } from '@control-plane/domain'
import { withTestApplication } from '@control-plane/testing'
import { createControlApiApplication, createOpenApiDocument } from './application.ts'
import {
  PolicyServiceAuthenticator,
  createInternalServicePrincipal,
} from './auth/service-authentication.ts'
import { start } from './index.ts'
import { DurableExecutionValidationService } from './executions/execution-validation.service.ts'
import { InMemoryRuntimeDiscoveryRepository } from './runtime-discovery/runtime-discovery.repository.ts'

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

async function createApplication(
  logs = [],
  serviceAuthenticator,
  runtimeDiscoveryRepository,
  executionValidationService
) {
  const application = await createControlApiApplication({
    health: () => ({ status: 'ok', metadata }),
    logger: { write: (entry) => logs.push(entry) },
    metadata,
    readiness: () => ({ status: 'ready', metadata }),
    executionValidationService,
    serviceAuthenticator,
    runtimeDiscoveryRepository,
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

  test('keeps a secret canary out of public API responses and request logs', async () => {
    const secretCanary = 'secret-canary-public-api-9f4a'
    const logs = []
    const application = await createApplication(logs)

    const response = await application.inject({
      method: 'GET',
      url: '/ready',
      headers: { authorization: `Bearer ${secretCanary}` },
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.stringify({ body: response.body, headers: response.headers, logs })).not.toContain(
      secretCanary
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

  test('fails closed when execution validation is not configured', async () => {
    const application = await createApplication(
      [],
      policyAuthenticator({
        claims: { ...validServiceClaims(), scopes: ['execution:validate'] },
      })
    )

    const response = await application.inject({
      method: 'POST',
      url: '/v1/executions/validate',
      headers: { authorization: 'Bearer valid-agent-hq-token' },
      payload: ControlApiFixtures.executionValidation.request,
    })

    expect(response.statusCode).toBe(503)
    expect(response.json().error.code).toBe('EXECUTION_VALIDATION_NOT_CONFIGURED')
  })

  test('resolves durable evidence and persists the execution plan before returning success', async () => {
    const contextPackage = contextPackageSerializationFixtures.futurePi
    const constraints = executionConstraintFixtures.write
    const profile = executionProfile(constraints)
    const skill = executionSkill()
    const persistedPlans = []
    const service = new DurableExecutionValidationService({
      compilerVersion: '1.0.0',
      contextPackages: {
        get: async () => globalThis.structuredClone(contextPackage),
      },
      plans: {
        get: async () => undefined,
        put: async (plan) => {
          persistedPlans.push(globalThis.structuredClone(plan))
          return {
            executionPlanId: plan.executionPlanId,
            contentDigest: plan.contentDigest,
          }
        },
      },
      profiles: { getAgentProfileVersion: async () => globalThis.structuredClone(profile) },
      projectStates: {
        getAtRevision: async () => ({
          schemaVersion: 1,
          workspaceId: contextPackage.projectState.workspaceId,
          projectId: contextPackage.projectState.projectId,
          revision: contextPackage.projectState.revision,
          items: [],
          createdAt: '2026-08-23T11:00:00.000Z',
          updatedAt: '2026-08-23T11:00:00.000Z',
        }),
      },
      skills: { getSkillVersion: async () => globalThis.structuredClone(skill) },
    })
    const request = executionValidationRequest(contextPackage, constraints)

    const response = await service.validate(request)
    const application = await createApplication(
      [],
      policyAuthenticator({
        claims: { ...validServiceClaims(), scopes: ['execution:validate'] },
      }),
      undefined,
      service
    )
    const httpResponse = await application.inject({
      method: 'POST',
      url: '/v1/executions/validate',
      headers: { authorization: 'Bearer valid-agent-hq-token' },
      payload: request,
    })

    expect(response.data.valid).toBe(true)
    expect(response.data.executionPlan).toEqual({
      executionPlanId: persistedPlans[0].executionPlanId,
      contentDigest: persistedPlans[0].contentDigest,
    })
    expect(persistedPlans[0].correlation).toMatchObject({
      workspaceId: request.workspaceId,
      projectId: request.projectId,
      taskId: request.payload.taskId,
      agentId: request.payload.agentId,
    })
    expect(httpResponse.statusCode).toBe(200)
    expect(httpResponse.json().data.executionPlan).toEqual(response.data.executionPlan)
    expect(persistedPlans).toHaveLength(2)

    await expect(
      service.validate({
        ...request,
        payload: {
          ...request.payload,
          policySnapshot: { ...request.payload.policySnapshot, revision: 999 },
        },
      })
    ).rejects.toMatchObject({ status: 422 })
    expect(persistedPlans).toHaveLength(2)
  })

  test('rejects malformed and unauthorized execution validation requests before composition', async () => {
    const wrongScope = await createApplication(
      [],
      policyAuthenticator({ claims: validServiceClaims() })
    )
    const forbidden = await wrongScope.inject({
      method: 'POST',
      url: '/v1/executions/validate',
      headers: { authorization: 'Bearer valid-agent-hq-token' },
      payload: ControlApiFixtures.executionValidation.request,
    })
    const malformed = await wrongScope.inject({
      method: 'POST',
      url: '/v1/executions/validate',
      headers: { authorization: 'Bearer valid-agent-hq-token' },
      payload: { operation: 'execution.validate' },
    })

    expect(forbidden.statusCode).toBe(403)
    expect(forbidden.json().error.code).toBe('SERVICE_CREDENTIAL_SCOPE_MISMATCH')
    expect(malformed.statusCode).toBe(400)
    expect(malformed.json().error.code).toBe('SERVICE_REQUEST_ENVELOPE_INVALID')
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

  test('serves scoped normalized runtime and external-session read models without native state', async () => {
    const repository = discoveryRepository()
    const application = await createApplication(
      [],
      policyAuthenticator({ claims: validServiceClaims() }),
      repository
    )

    const runtimeList = await application.inject({
      method: 'POST',
      url: '/v1/runtime-connections/list',
      headers: { authorization: 'Bearer valid-agent-hq-token' },
      payload: discoveryRequest('runtime-connection.list', {
        limit: 1,
        runtimeNodeRefId: runtimeModel().node.runtimeNodeRefId,
        states: ['stale'],
        requiredCapabilities: ['session.resume'],
      }),
    })
    const runtimeGet = await application.inject({
      method: 'POST',
      url: '/v1/runtime-connections/get',
      headers: { authorization: 'Bearer valid-agent-hq-token' },
      payload: discoveryRequest('runtime-connection.get', {
        runtimeConnectionId: runtimeModel().runtimeConnectionId,
        runtimeNodeRefId: runtimeModel().node.runtimeNodeRefId,
      }),
    })
    const sessionList = await application.inject({
      method: 'POST',
      url: '/v1/external-sessions/list',
      headers: { authorization: 'Bearer valid-agent-hq-token' },
      payload: discoveryRequest('external-session.list', {
        limit: 50,
        states: ['revoked'],
      }),
    })

    expect(runtimeList.statusCode).toBe(200)
    expect(runtimeList.json().data.runtimeConnections).toHaveLength(1)
    expect(runtimeList.json().data.runtimeConnections[0]).toMatchObject({
      node: { health: 'online' },
      connection: { health: 'degraded', availability: 'stale' },
      freshness: { state: 'stale' },
      eligibility: {
        state: 'ineligible',
        reasons: ['REQUIRED_CAPABILITY_INSUFFICIENT', 'RUNTIME_STALE'],
      },
    })
    expect(runtimeGet.statusCode).toBe(200)
    expect(sessionList.statusCode).toBe(200)
    expect(sessionList.json().data.externalSessions[0].capabilitySummary.controls.resume).toEqual({
      available: false,
      reason: 'SESSION_REVOKED',
    })
    const serialized = JSON.stringify({
      runtime: runtimeGet.json(),
      sessions: sessionList.json(),
    })
    for (const prohibited of [
      '/Users/example',
      'opaqueNativeRef',
      'opaqueNativeSessionId',
      'processHandle',
      'nativeConfig',
      'nativeSessionState',
      'super-secret-native-token',
    ]) {
      expect(serialized).not.toContain(prohibited)
    }
  })

  test('rejects cross-workspace discovery and returns scoped not-found results', async () => {
    const repository = discoveryRepository()
    const application = await createApplication(
      [],
      policyAuthenticator({ claims: validServiceClaims() }),
      repository
    )
    const crossWorkspace = await application.inject({
      method: 'POST',
      url: '/v1/runtime-connections/list',
      headers: { authorization: 'Bearer valid-agent-hq-token' },
      payload: {
        ...discoveryRequest('runtime-connection.list', {
          limit: 50,
          states: [],
          requiredCapabilities: [],
        }),
        workspaceId: 'wsp_01JBBCDEF0123456789ABCDEFG',
      },
    })
    const missing = await application.inject({
      method: 'POST',
      url: '/v1/external-sessions/get',
      headers: { authorization: 'Bearer valid-agent-hq-token' },
      payload: discoveryRequest('external-session.get', {
        externalSessionId: 'ses_01JBBCDEF0123456789ABCDEFG',
      }),
    })
    const malformed = await application.inject({
      method: 'POST',
      url: '/v1/runtime-connections/list',
      headers: { authorization: 'Bearer valid-agent-hq-token' },
      payload: discoveryRequest('runtime-connection.list', {
        limit: 101,
        states: [],
        requiredCapabilities: [],
      }),
    })

    expect(crossWorkspace.statusCode).toBe(403)
    expect(crossWorkspace.json().error.code).toBe('SERVICE_CREDENTIAL_SCOPE_MISMATCH')
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error.code).toBe('EXTERNAL_SESSION_NOT_FOUND')
    expect(malformed.statusCode).toBe(400)
    expect(malformed.json().error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
    })
    expect(malformed.json().error.details).toContainEqual(
      expect.objectContaining({ field: 'parameters.limit' })
    )
  })

  test('generates versioned OpenAPI paths', async () => {
    const application = await createApplication()

    const document = createOpenApiDocument(application)

    expect(document.openapi).toStartWith('3.')
    expect(document.paths).toHaveProperty('/v1/system/echo')
    expect(document.paths).toHaveProperty('/v1/executions/validate')
    expect(document.paths).toHaveProperty('/v1/runtime-connections/list')
    expect(document.paths).toHaveProperty('/v1/external-sessions/list')
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

  test('wires runtime discovery through the production start boundary', async () => {
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
      runtimeDiscoveryRepository: discoveryRepository(),
      serviceAuthenticator: policyAuthenticator({ claims: validServiceClaims() }),
    })

    const response = await started.application.inject({
      method: 'POST',
      url: '/v1/runtime-connections/list',
      headers: { authorization: 'Bearer valid-agent-hq-token' },
      payload: discoveryRequest('runtime-connection.list', {
        limit: 50,
        states: [],
        requiredCapabilities: [],
      }),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.runtimeConnections).toHaveLength(1)

    await processAdapter.emit('SIGTERM')
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
    scopes: ['runtime:read', 'system:authenticate'],
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

function executionValidationRequest(contextPackage, constraints) {
  return {
    ...ControlApiFixtures.executionValidation.request,
    payload: {
      ...ControlApiFixtures.executionValidation.request.payload,
      contextPackage: {
        contextPackageId: contextPackage.contextPackageId,
        contentDigest: contextPackage.contentDigest,
        schemaVersion: contextPackage.schemaVersion,
        compilerVersion: contextPackage.compiler.version,
      },
      projectState: contextPackage.projectState,
      policySnapshot: {
        policySnapshotId: constraints.policySnapshot.policyId,
        revision: constraints.policySnapshot.version,
        contentDigest: constraints.policySnapshot.digest,
      },
      runtimeRequirements: ['stream.output'],
      outputContractRef: 'contract://execution-result/v1',
    },
  }
}

function executionProfile(constraints) {
  return {
    profileVersionId: 'pfv_01JABCDEF0123456789ABCDEFG',
    profileId: 'prf_01JABCDEF0123456789ABCDEFG',
    version: 3,
    revision: 2,
    lifecycle: 'published',
    contentDigest: `sha256:${'a'.repeat(64)}`,
    definition: {
      schemaVersion: 1,
      roleInstructions: 'Complete the assigned task safely.',
      skills: [
        {
          skillId: 'skl_01JABCDEF0123456789ABCDEFG',
          skillVersionId: 'skv_01JABCDEF0123456789ABCDEFG',
          contentDigest: `sha256:${'b'.repeat(64)}`,
        },
      ],
      capabilityRequirements: ['filesystem.read'],
      executionConstraints: globalThis.structuredClone(constraints),
      outputContractRefs: ['contract://execution-result/v1'],
    },
    createdAt: '2026-08-22T12:00:00.000Z',
    lifecycleMetadata: { publishedAt: '2026-08-22T12:00:00.000Z' },
  }
}

function executionSkill() {
  return {
    skillVersionId: 'skv_01JABCDEF0123456789ABCDEFG',
    skillId: 'skl_01JABCDEF0123456789ABCDEFG',
    revision: 4,
    lifecycle: 'published',
    manifest: {
      schemaVersion: 1,
      semanticVersion: '2.1.0',
      contentDigest: `sha256:${'b'.repeat(64)}`,
      requiredCapabilities: ['filesystem.read'],
      requiredTools: [{ toolId: 'project-files', versionRange: '^1.0.0' }],
      compatibleProfileSchemaVersions: [1],
      compatibleContractMajorVersions: [1],
    },
    content: { instructions: 'Inspect and update project files.', artifactRefs: [] },
    createdAt: '2026-08-22T12:00:00.000Z',
    lifecycleMetadata: { publishedAt: '2026-08-22T12:00:00.000Z' },
  }
}

function discoveryRequest(operation, parameters) {
  return {
    caller: { servicePrincipalId: 'svc_agent-hq' },
    contractVersion: { major: 1, minor: 0 },
    correlation: { traceId: 'trc_01JABCDEF0123456789ABCDEFG' },
    operation,
    parameters,
    projectId: 'prj_01JABCDEF0123456789ABCDEFG',
    requestId: 'req_01JABCDEF0123456789ABCDEFG',
    requestedAt: '2026-08-24T12:00:00.000Z',
    workspaceId: 'wsp_01JABCDEF0123456789ABCDEFG',
  }
}

function runtimeModel() {
  return {
    runtimeConnectionId: 'rtc_01JABCDEF0123456789ABCDEFG',
    runtimeDefinitionId: 'rtd_01JABCDEF0123456789ABCDEFG',
    family: 'codex',
    connectionType: 'managed_local',
    location: 'local_device',
    status: 'unavailable',
    node: {
      runtimeNodeRefId: 'rnr_01JABCDEF0123456789ABCDEFG',
      location: 'local_device',
      status: 'online',
      health: 'online',
      observedAt: '2026-08-24T11:59:00.000Z',
    },
    connection: { status: 'degraded', health: 'degraded', availability: 'stale' },
    freshness: {
      state: 'stale',
      observedAt: '2026-08-24T11:50:00.000Z',
      expiresAt: '2026-08-24T11:55:00.000Z',
    },
    versions: { adapter: '1.2.0', driver: '1.1.0', harness: '2.0.0' },
    capabilities: ['session.resume'],
    capabilityDetails: [
      { name: 'session.resume', support: 'degraded', limitations: ['HISTORY_UNAVAILABLE'] },
    ],
    compatibility: { state: 'incompatible', limitations: ['DRIVER_MAJOR_MISMATCH'] },
    access: {
      localProjectGrant: { required: true, state: 'missing' },
      entitlement: { state: 'allowed', class: 'standard' },
    },
    eligibility: {
      state: 'ineligible',
      reasons: ['REQUIRED_CAPABILITY_INSUFFICIENT', 'RUNTIME_STALE'],
      degradations: [],
      remediation: [{ code: 'REFRESH_RUNTIME', label: 'Refresh runtime health and capabilities' }],
    },
    observedAt: '2026-08-24T11:50:00.000Z',
    limitations: ['HISTORY_UNAVAILABLE'],
    opaqueNativeRef: 'nref_01JABCDEF0123456789ABCDEFG',
    rawPath: '/Users/example/.runtime',
    processHandle: 4412,
    credentials: { token: 'super-secret-native-token' },
    nativeConfig: { unrestricted: true },
  }
}

function externalSessionModel() {
  return {
    externalSessionId: 'ses_01JABCDEF0123456789ABCDEFG',
    runtimeConnectionId: runtimeModel().runtimeConnectionId,
    projectId: 'prj_01JABCDEF0123456789ABCDEFG',
    state: 'revoked',
    recoverable: false,
    display: { origin: 'native_discovery', displayName: 'Review session' },
    freshness: {
      state: 'expired',
      observedAt: '2026-08-24T11:00:00.000Z',
      expiresAt: '2026-08-24T11:05:00.000Z',
    },
    capabilitySummary: {
      version: 4,
      operations: ['session.resume'],
      controls: {
        reference: { available: true },
        resume: { available: false, reason: 'SESSION_REVOKED' },
        load: { available: false, reason: 'SESSION_REVOKED' },
        close: { available: false, reason: 'SESSION_REVOKED' },
        history: { available: false, reason: 'SESSION_REVOKED' },
      },
    },
    limitations: ['SESSION_REVOKED'],
    opaqueNativeSessionId: 'nses_01JABCDEF0123456789ABCDEFG',
    nativeSessionState: { messages: ['private'] },
  }
}

function discoveryRepository() {
  return new InMemoryRuntimeDiscoveryRepository(
    [
      {
        workspaceId: 'wsp_01JABCDEF0123456789ABCDEFG',
        model: runtimeModel(),
      },
    ],
    [
      {
        workspaceId: 'wsp_01JABCDEF0123456789ABCDEFG',
        projectId: 'prj_01JABCDEF0123456789ABCDEFG',
        runtimeNodeRefId: runtimeModel().node.runtimeNodeRefId,
        model: externalSessionModel(),
      },
    ]
  )
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

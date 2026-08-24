import { createHash } from 'node:crypto'
import { createControlApiApplication } from '../../apps/control-api/dist/application.js'
import { PolicyServiceAuthenticator } from '../../apps/control-api/dist/auth/service-authentication.js'
import { InMemoryRuntimeDiscoveryRepository } from '../../apps/control-api/dist/runtime-discovery/runtime-discovery.repository.js'
import { ExecutionLifecycleService, InMemoryExecutionRepository } from '@control-plane/domain'
import {
  ExternalSessionRegistry,
  InMemoryExternalSessionRepository,
  InMemoryRuntimeConnectionRepository,
  RuntimeConnectionRegistry,
  assessExternalSession,
  evaluateRuntimeEligibility,
  projectExternalSessionDiscovery,
  projectRuntimeConnectionDiscovery,
  routeRuntimeConnections,
  toAttemptRoutingDecision,
} from '@control-plane/runtime-sdk'

export const runtimeFabricIds = Object.freeze({
  workspace: 'wsp_01JABCDEF0123456789ABCDEFG',
  project: 'prj_01JABCDEF0123456789ABCDEFG',
  node: 'rnr_01JABCDEF0123456789ABCDEFG',
  local: 'rtc_01JABCDEF0123456789ABCDEFG',
  cloud: 'rtc_01JBBCDEF0123456789ABCDEFG',
  unhealthy: 'rtc_01JZBCDEF0123456789ABCDEFG',
  denied: 'rtc_01JYBCDEF0123456789ABCDEFG',
  missing: 'rtc_01JXBCDEF0123456789ABCDEFG',
  localDefinition: 'rtd_01JABCDEF0123456789ABCDEFG',
  cloudDefinition: 'rtd_01JBBCDEF0123456789ABCDEFG',
  unhealthyDefinition: 'rtd_01JZBCDEF0123456789ABCDEFG',
  deniedDefinition: 'rtd_01JYBCDEF0123456789ABCDEFG',
  missingDefinition: 'rtd_01JXBCDEF0123456789ABCDEFG',
  session: 'ses_01JABCDEF0123456789ABCDEFG',
  execution: 'exe_01JABCDEF0123456789ABCDEFG',
  attempt: 'att_01JABCDEF0123456789ABCDEFG',
  plan: 'pln_01JABCDEF0123456789ABCDEFG',
  task: 'tsk_01JABCDEF0123456789ABCDEFG',
  agent: 'agt_01JABCDEF0123456789ABCDEFG',
  request: 'req_01JABCDEF0123456789ABCDEFG',
})

const observedAt = '2026-08-24T20:01:10.000Z'
const evaluatedAt = '2026-08-24T20:01:30.000Z'
const capabilityExpiry = '2026-08-24T20:02:00.000Z'

export async function createRuntimeFabricAcceptanceHarness() {
  const connectionRepository = new InMemoryRuntimeConnectionRepository()
  const registry = new RuntimeConnectionRegistry(connectionRepository)
  const local = await registerConnection(registry, {
    runtimeConnectionId: runtimeFabricIds.local,
    runtimeDefinitionId: runtimeFabricIds.localDefinition,
    connectionType: 'managed_local',
    runtimeNodeRefId: runtimeFabricIds.node,
    location: 'local_device',
    opaqueNativeRef: 'nref_01JABCDEF0123456789ABCDEFG',
    capabilities: [
      capability('stream.output'),
      capability('tool.call'),
      capability('session.resume'),
      capability('session.close'),
    ],
  })
  const unhealthy = await registerConnection(registry, {
    runtimeConnectionId: runtimeFabricIds.unhealthy,
    runtimeDefinitionId: runtimeFabricIds.unhealthyDefinition,
    connectionType: 'external_local',
    runtimeNodeRefId: runtimeFabricIds.node,
    location: 'local_device',
    opaqueNativeRef: 'nref_01JZBCDEF0123456789ABCDEFG',
    status: 'unavailable',
    health: 'unavailable',
    availabilityState: 'offline',
    capabilities: [capability('stream.output')],
  })
  const cloud = await registerConnection(registry, {
    runtimeConnectionId: runtimeFabricIds.cloud,
    runtimeDefinitionId: runtimeFabricIds.cloudDefinition,
    connectionType: 'managed_cloud',
    location: 'managed_sandbox',
    capabilities: [capability('stream.output'), capability('tool.call')],
  })
  const denied = await registerConnection(registry, {
    runtimeConnectionId: runtimeFabricIds.denied,
    runtimeDefinitionId: runtimeFabricIds.deniedDefinition,
    connectionType: 'managed_cloud',
    location: 'managed_sandbox',
    capabilities: [capability('stream.output'), capability('tool.call')],
  })
  const missing = await registerConnection(registry, {
    runtimeConnectionId: runtimeFabricIds.missing,
    runtimeDefinitionId: runtimeFabricIds.missingDefinition,
    connectionType: 'managed_cloud',
    location: 'managed_sandbox',
    capabilities: [capability('stream.output')],
  })
  const stale = {
    ...local,
    availabilityState: 'stale',
    capabilitySnapshotExpiresAt: '2026-08-24T20:01:20.000Z',
  }
  const changed = {
    ...local,
    capabilities: [capability('stream.output'), capability('session.close')],
    capabilitySnapshotVersion: 2,
    capabilitySnapshotObservedAt: '2026-08-24T20:01:20.000Z',
  }
  const connections = { local, unhealthy, cloud, denied, missing, stale, changed }
  const eligibility = {
    local: eligibilityFor(local, routeRequirements()),
    cloud: eligibilityFor(cloud, routeRequirements()),
    denied: eligibilityFor(denied, routeRequirements(), {
      deniedRuntimeConnectionIds: [runtimeFabricIds.denied],
      security: { status: 'denied', reasonCode: 'WORKSPACE_RUNTIME_BLOCKED' },
    }),
    missing: eligibilityFor(missing, [{ capability: 'tool.call', necessity: 'required' }]),
  }
  const sessionRegistry = new ExternalSessionRegistry(new InMemoryExternalSessionRepository())
  const executionRepository = new InMemoryExecutionRepository()
  const executionLifecycle = new ExecutionLifecycleService(executionRepository)

  return {
    registry,
    connections,
    eligibility,
    executionRepository,
    readModel(connection, options = {}) {
      return projectRuntimeConnectionDiscovery({
        connection,
        family: 'mock',
        ...(connection.connectionType === 'managed_cloud'
          ? { nodeHealth: 'not_applicable' }
          : {
              node: nodeReference(),
              nodeHealth: 'online',
            }),
        evaluatedAt,
        localProjectGrant: {
          required: connection.connectionType !== 'managed_cloud',
          state: connection.connectionType === 'managed_cloud' ? 'not_required' : 'granted',
        },
        entitlement: { state: 'allowed', class: 'standard' },
        requiredCapabilities: options.requiredCapabilities ?? [],
      })
    },
    route(candidates, preference) {
      return route(candidates, eligibility, preference, false)
    },
    routeTied(candidates) {
      return route(candidates, eligibility, undefined, true)
    },
    registerSession() {
      return sessionRegistry.register({
        externalSessionId: runtimeFabricIds.session,
        runtimeConnectionId: runtimeFabricIds.local,
        opaqueNativeSessionId: 'nses_01JABCDEF0123456789ABCDEFG',
        workspaceId: runtimeFabricIds.workspace,
        projectId: runtimeFabricIds.project,
        state: 'active',
        ownership: {
          authority: 'external_runtime',
          imported: false,
          concurrentNativeUse: 'allowed',
        },
        capabilitySnapshot: {
          version: 1,
          observedAt,
          expiresAt: capabilityExpiry,
          operations: ['session.resume'],
        },
        safeMetadata: {
          origin: 'native_discovery',
          displayName: 'Acceptance session',
          limitations: [],
        },
        lastObservedAt: observedAt,
      })
    },
    assessSession(session, connection) {
      return assessExternalSession(session, {
        connection,
        nodeStatus: 'online',
        evaluatedAt,
      })
    },
    sessionReadModel(session, assessment) {
      return projectExternalSessionDiscovery({ session, assessment })
    },
    async fetchAgentHqReadModels(runtimeModel, sessionModel) {
      const application = await createAgentHqApplication(runtimeModel, sessionModel)
      try {
        const runtime = await application.inject({
          method: 'POST',
          url: '/v1/runtime-connections/list',
          headers: { authorization: 'Bearer runtime-fabric-acceptance-token' },
          payload: discoveryRequest('runtime-connection.list', {
            limit: 50,
            states: [],
            requiredCapabilities: [],
          }),
        })
        const session = await application.inject({
          method: 'POST',
          url: '/v1/external-sessions/list',
          headers: { authorization: 'Bearer runtime-fabric-acceptance-token' },
          payload: discoveryRequest('external-session.list', { limit: 50, states: [] }),
        })
        return {
          runtime: { statusCode: runtime.statusCode, body: runtime.json() },
          session: { statusCode: session.statusCode, body: session.json() },
        }
      } finally {
        await application.close()
      }
    },
    async recordAttempt(decision) {
      const selectedConnection = [local, unhealthy, cloud, denied, missing].find(
        ({ runtimeConnectionId }) => runtimeConnectionId === decision.selected.runtimeConnectionId
      )
      if (selectedConnection === undefined) throw new Error('Selected runtime fixture is missing')
      const execution = await executionLifecycle.createExecution({
        executionId: runtimeFabricIds.execution,
        correlation: {
          workspaceId: runtimeFabricIds.workspace,
          projectId: runtimeFabricIds.project,
          taskId: runtimeFabricIds.task,
          agentId: runtimeFabricIds.agent,
          requestId: runtimeFabricIds.request,
        },
        executionPlan: {
          executionPlanId: runtimeFabricIds.plan,
          contentDigest: `sha256:${'9'.repeat(64)}`,
          schemaVersion: 1,
        },
        acceptedAt: '2026-08-24T20:01:00.000Z',
      })
      return executionLifecycle.createAttempt({
        executionId: execution.executionId,
        attemptId: runtimeFabricIds.attempt,
        expectedExecutionVersion: execution.version,
        queuedAt: '2026-08-24T20:01:31.000Z',
        runtime: {
          runtimeDefinitionId: selectedConnection.runtimeDefinitionId,
          ...(selectedConnection.runtimeNodeRefId === undefined
            ? {}
            : { runtimeNodeRefId: selectedConnection.runtimeNodeRefId }),
          runtimeConnectionId: selectedConnection.runtimeConnectionId,
          routingDecision: toAttemptRoutingDecision(decision),
        },
      })
    },
    async disconnectSelected(runtimeConnectionId) {
      const connection = await registry.get(runtimeConnectionId)
      if (connection === undefined) throw new Error('Selected runtime inventory is missing')
      return registry.disconnect({
        runtimeConnectionId,
        expectedVersion: connection.version,
        observedAt: '2026-08-24T20:03:00.000Z',
      })
    },
  }
}

async function createAgentHqApplication(runtimeModel, sessionModel) {
  const metadata = {
    serviceName: 'control-api',
    version: '1.0.0',
    commitSha: 'm4-acceptance',
    environment: 'test',
    instanceId: 'm4-acceptance',
  }
  return createControlApiApplication({
    health: () => ({ status: 'ok', metadata }),
    readiness: () => ({ status: 'ready', metadata }),
    logger: { write: () => undefined },
    metadata,
    serviceAuthenticator: new PolicyServiceAuthenticator({
      audience: 'control-plane',
      issuer: 'https://agent-hq.example',
      logger: { write: () => undefined },
      now: () => new Date(evaluatedAt),
      revocationChecker: { isRevoked: async () => false },
      verifier: {
        verify: async () => ({
          audience: 'control-plane',
          credentialId: 'credential-m4-acceptance',
          credentialKind: 'service',
          expiresAt: '2026-08-24T21:00:00.000Z',
          issuedAt: '2026-08-24T20:00:00.000Z',
          issuer: 'https://agent-hq.example',
          keyId: 'm4-acceptance',
          principalId: 'svc_agent-hq',
          projectIds: [runtimeFabricIds.project],
          scopes: ['runtime:read'],
          workspaceIds: [runtimeFabricIds.workspace],
        }),
      },
    }),
    runtimeDiscoveryRepository: new InMemoryRuntimeDiscoveryRepository(
      [
        {
          workspaceId: runtimeFabricIds.workspace,
          model: {
            ...runtimeModel,
            rawPath: '/Users/example/private-runtime',
            credentials: { token: 'super-secret-native-token' },
          },
        },
      ],
      [
        {
          workspaceId: runtimeFabricIds.workspace,
          projectId: runtimeFabricIds.project,
          runtimeNodeRefId: runtimeFabricIds.node,
          model: {
            ...sessionModel,
            opaqueNativeSessionId: 'nses_01JABCDEF0123456789ABCDEFG',
            nativeSessionState: { credential: 'super-secret-native-token' },
          },
        },
      ]
    ),
  })
}

function discoveryRequest(operation, parameters) {
  return {
    caller: { servicePrincipalId: 'svc_agent-hq' },
    contractVersion: { major: 1, minor: 0 },
    correlation: { traceId: 'trc_01JABCDEF0123456789ABCDEFG' },
    operation,
    parameters,
    projectId: runtimeFabricIds.project,
    requestId: runtimeFabricIds.request,
    requestedAt: evaluatedAt,
    workspaceId: runtimeFabricIds.workspace,
  }
}

async function registerConnection(registry, input) {
  const registered = await registry.register({
    runtimeConnectionId: input.runtimeConnectionId,
    identityDigest: identityDigest(input.runtimeConnectionId),
    connectionType: input.connectionType,
    ...(input.runtimeNodeRefId === undefined ? {} : { runtimeNodeRefId: input.runtimeNodeRefId }),
    runtimeDefinitionId: input.runtimeDefinitionId,
    location: input.location,
    ...(input.opaqueNativeRef === undefined ? {} : { opaqueNativeRef: input.opaqueNativeRef }),
    adapterVersion: '1.0.0',
    driverVersion: '1.0.0',
    harnessVersion: '1.0.0',
    status: input.status ?? 'connected',
    health: input.health ?? 'healthy',
    capabilities: input.capabilities,
    compatibilityState: 'compatible',
    limitations: [],
    lastDiscoveredAt: '2026-08-24T20:01:00.000Z',
    lastHeartbeatAt: '2026-08-24T20:01:00.000Z',
    lastHealthCheckAt: '2026-08-24T20:01:00.000Z',
  })
  return registry.update({
    runtimeConnectionId: registered.runtimeConnectionId,
    expectedVersion: registered.version,
    observedAt,
    availabilityState: input.availabilityState ?? 'healthy',
    protocolVersion: '1.0.0',
    capabilitySnapshotVersion: 1,
    capabilitySnapshotObservedAt: observedAt,
    capabilitySnapshotExpiresAt: capabilityExpiry,
    capabilityVerification: 'verified',
    lastHealthCheckAt: observedAt,
    diagnostics: [],
  })
}

function eligibilityFor(connection, requirements, policyOverrides = {}) {
  const managedCloud = connection.connectionType === 'managed_cloud'
  return evaluateRuntimeEligibility({
    eligibilityVersion: 1,
    evaluatedAt,
    executionPlan: {
      executionPlanId: runtimeFabricIds.plan,
      contentDigest: `sha256:${'9'.repeat(64)}`,
      runtimeRequirements: requirements,
    },
    candidate: {
      family: 'mock',
      nodeStatus: managedCloud ? 'not_applicable' : 'online',
      connection,
    },
    policy: {
      snapshot: {
        policyId: 'runtime-fabric-acceptance',
        version: 1,
        digest: `sha256:${'8'.repeat(64)}`,
      },
      allowedFamilies: ['mock'],
      allowedLocations: ['local_device', 'managed_sandbox'],
      deniedRuntimeConnectionIds: [],
      requireVerifiedCapabilities: true,
      security: { status: 'allowed' },
      ...policyOverrides,
    },
    localProjectGrant: managedCloud
      ? { required: false, status: 'not_required' }
      : { required: true, status: 'granted', grantRef: 'grant:m4-acceptance' },
    entitlement: { status: 'allowed', class: 'standard' },
  })
}

function route(candidates, eligibility, preference, tied) {
  const eligibilityById = new Map(
    Object.values(eligibility).map((decision) => [decision.audit.runtimeConnectionId, decision])
  )
  return routeRuntimeConnections({
    routingVersion: 1,
    executionPlanId: runtimeFabricIds.plan,
    evaluatedAt: '2026-08-24T20:01:30.000Z',
    policy: routingPolicy(),
    ...(preference === undefined ? {} : { preference }),
    candidates: candidates.map((connection) => ({
      runtimeConnectionId: connection.runtimeConnectionId,
      family: 'mock',
      deployment: connection.connectionType === 'managed_cloud' ? 'managed' : 'local',
      eligibility:
        eligibilityById.get(connection.runtimeConnectionId) ??
        eligibilityFor(connection, routeRequirements()),
      signals: tied
        ? routingSignals({ locality: 50, loadPermille: 200, queueDepth: 1 })
        : connection.connectionType === 'managed_cloud'
          ? routingSignals({ locality: 30, loadPermille: 100, queueDepth: 0 })
          : routingSignals({ locality: 100, loadPermille: 200, queueDepth: 1 }),
    })),
  })
}

function routeRequirements() {
  return [
    { capability: 'stream.output', necessity: 'required' },
    { capability: 'session.history', necessity: 'optional' },
  ]
}

function routingPolicy() {
  return {
    policyId: 'runtime-fabric-routing',
    version: 1,
    digest: `sha256:${'7'.repeat(64)}`,
    weights: {
      explicitConnection: 1_000_000,
      preferredFamily: 100_000,
      preferredDeployment: 10_000,
      locality: 100,
      health: 100,
      load: 10,
      queue: 10,
      entitlement: 10,
      cost: 10,
    },
  }
}

function routingSignals(overrides) {
  return {
    locality: 50,
    health: 90,
    loadPermille: 200,
    queueDepth: 1,
    entitlementPriority: 50,
    costClass: 'low',
    ...overrides,
  }
}

function capability(name, support = 'supported') {
  return { name, support }
}

function nodeReference() {
  return {
    runtimeNodeRefId: runtimeFabricIds.node,
    authority: 'agent_hq',
    displayName: 'Acceptance node',
    location: 'local_device',
    status: 'online',
    observedAt,
  }
}

function identityDigest(runtimeConnectionId) {
  return `sha256:${createHash('sha256').update(runtimeConnectionId).digest('hex')}`
}

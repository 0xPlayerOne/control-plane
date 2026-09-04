import { PolicyServiceAuthenticator } from '../../apps/control-api/src/auth/service-authentication.ts'
import { ContextPackageCompiler, InMemoryContextPackageRepository } from '@control-plane/context'
import { ControlApiFixtures } from '@control-plane/contracts'
import {
  InMemoryProjectStateRepository,
  InMemoryStatePromotionProposalRepository,
  InMemoryVersionedCatalogRepository,
  ProjectStateService,
  RecordingProjectStateEventPublisher,
  VersionedCatalog,
  executionConstraintFixtures,
} from '@control-plane/domain'
import {
  ExecutionPlanCompiler,
  InMemoryExecutionPlanRepository,
} from '@control-plane/execution-plan'
import { ControlPlaneClient } from '@control-plane/sdk'

export const coreAcceptanceIds = Object.freeze({
  agentId: 'agt_01JABCDEF0123456789ABCDEFG',
  commandId: 'cmd_01JABCDEF0123456789ABCDEFG',
  foreignProfileId: 'prf_01JZBCDEF0123456789ABCDEFG',
  foreignWorkspaceId: 'wsp_01JZBCDEF0123456789ABCDEFG',
  itemId: 'psi_01JABCDEF0123456789ABCDEFG',
  mutationId: 'stm_01JABCDEF0123456789ABCDEFG',
  profileId: 'prf_01JABCDEF0123456789ABCDEFG',
  profileVersionId: 'pfv_01JABCDEF0123456789ABCDEFG',
  projectId: 'prj_01JABCDEF0123456789ABCDEFG',
  requestId: 'req_01JABCDEF0123456789ABCDEFG',
  skillId: 'skl_01JABCDEF0123456789ABCDEFG',
  skillVersionId: 'skv_01JABCDEF0123456789ABCDEFG',
  taskId: 'tsk_01JABCDEF0123456789ABCDEFG',
  traceId: 'trc_01JABCDEF0123456789ABCDEFG',
  workspaceId: 'wsp_01JABCDEF0123456789ABCDEFG',
})

const createdAt = '2026-08-23T12:00:00.000Z'
const publishedAt = '2026-08-23T13:00:00.000Z'
const compiledAt = '2026-08-23T14:00:00.000Z'
const planCompiledAt = '2026-08-23T15:00:00.000Z'
const outputContractRef = 'agent-hq://contracts/task-result/v1'

export async function createCoreDomainAcceptanceHarness() {
  const logs = []
  const catalogRepository = new InMemoryVersionedCatalogRepository()
  const catalog = new VersionedCatalog(catalogRepository, catalogRepository)
  const { profile, skill } = await seedCatalog(catalog)
  const projectStateService = new ProjectStateService(
    new InMemoryProjectStateRepository(),
    new InMemoryStatePromotionProposalRepository(),
    new RecordingProjectStateEventPublisher()
  )
  await projectStateService.initialize({
    workspaceId: coreAcceptanceIds.workspaceId,
    projectId: coreAcceptanceIds.projectId,
    at: createdAt,
  })
  const mutation = await projectStateService.applyMutation({
    mutationId: coreAcceptanceIds.mutationId,
    workspaceId: coreAcceptanceIds.workspaceId,
    projectId: coreAcceptanceIds.projectId,
    expectedRevision: 0,
    actorPrincipalRef: 'principal://agent-hq/service/core-acceptance',
    operations: [
      {
        kind: 'append',
        item: {
          itemId: coreAcceptanceIds.itemId,
          key: 'objective',
          value: 'Compile the pinned M2 execution configuration',
          sensitivity: 'internal',
          freshness: { observedAt: createdAt },
          provenance: {
            sourceKind: 'principal',
            sourcePrincipalRef: 'principal://agent-hq/service/core-acceptance',
            artifactRefs: [],
            capturedAt: createdAt,
          },
        },
      },
    ],
    at: publishedAt,
  })
  const projectState = mutation.state
  const contextRepository = new InMemoryContextPackageRepository()
  const planRepository = new InMemoryExecutionPlanRepository()
  const contextCompiler = new ContextPackageCompiler('1.0.0')
  const planCompiler = new ExecutionPlanCompiler('1.0.0')
  const dispatchAttempts = []
  const runtimeDispatch = {
    async dispatch(reference) {
      dispatchAttempts.push(globalThis.structuredClone(reference))
      throw new Error('RUNTIME_DISPATCH_FORBIDDEN_IN_M2_ACCEPTANCE')
    },
  }
  const dispatchAfter = async (operation) => runtimeDispatch.dispatch(await operation())

  const defaultClaims = serviceClaims()
  const authenticatorFor = (claims = defaultClaims, revoked = false) =>
    new PolicyServiceAuthenticator({
      audience: 'control-plane',
      clockSkewMs: 0,
      issuer: 'https://agent-hq.example',
      logger: { write: (entry) => logs.push(entry) },
      now: () => new Date(compiledAt),
      revocationChecker: { isRevoked: async () => revoked },
      verifier: { verify: async () => claims },
    })

  const authenticate = async ({
    body = authenticationEnvelope(),
    claims = defaultClaims,
    requiredScopes = ['system:authenticate'],
    revoked = false,
    token = 'agent-hq-service-token',
  } = {}) =>
    authenticatorFor(claims, revoked).authenticate(
      {
        id: coreAcceptanceIds.requestId,
        headers: { authorization: `Bearer ${token}` },
        body,
      },
      requiredScopes
    )

  const contextInput = () => ({
    objective: 'Compile a provider-neutral execution configuration',
    projectState: globalThis.structuredClone(projectState),
    expectedProjectStateRevision: projectState.revision,
    candidates: [
      {
        itemId: coreAcceptanceIds.itemId,
        itemRevision: 1,
        required: true,
        priority: 10,
        authorized: true,
      },
    ],
    artifacts: [],
    constraints: {
      allowedSensitivities: ['public', 'internal'],
      allowedStateItemIds: [coreAcceptanceIds.itemId],
      allowedArtifactIds: [],
    },
    permissions: ['project-state:read'],
    successCriteria: ['Every configuration input is pinned and auditable'],
    returnContract: { contractRef: outputContractRef },
    budgets: { maximumBytes: 4_096, maximumTokens: 1_024 },
    compiledAt,
  })

  const planInput = (contextPackage) => ({
    correlation: {
      workspaceId: coreAcceptanceIds.workspaceId,
      projectId: coreAcceptanceIds.projectId,
      taskId: coreAcceptanceIds.taskId,
      agentId: coreAcceptanceIds.agentId,
      requestId: coreAcceptanceIds.requestId,
    },
    profile: globalThis.structuredClone(profile),
    skills: [globalThis.structuredClone(skill)],
    contextPackage: globalThis.structuredClone(contextPackage),
    constraints: coreExecutionConstraints(),
    requestConstraints: [],
    runtimeRequirements: [
      { capability: 'stream.output', necessity: 'required', minimumSupport: 'supported' },
    ],
    outputContract: { contractRef: outputContractRef },
    compiledAt: planCompiledAt,
  })

  const compileContext = (mutate = () => undefined) => {
    const input = contextInput()
    mutate(input)
    return contextCompiler.compile(input)
  }
  const compilePlan = (contextPackage, mutate = () => undefined) => {
    const input = planInput(contextPackage)
    mutate(input)
    return planCompiler.compile(input)
  }

  const submitIntent = async ({
    mutatePublicRequest = () => undefined,
    responseContractVersion = { major: 3, minor: 0 },
  } = {}) => {
    const principal = await authenticate()
    const profileResolution = await catalog.resolveAgentProfile(
      { profileId: profile.profileId, profileVersionId: profile.profileVersionId },
      { capabilities: ['filesystem.read'], tools: ['project-files'], contractMajorVersion: 1 }
    )
    if (profileResolution.state !== 'available') {
      throw new Error(`PROFILE_RESOLUTION_${profileResolution.state.toUpperCase()}`)
    }
    const skillResolution = await catalog.resolveSkill(profile.definition.skills[0])
    if (skillResolution.state !== 'available') {
      throw new Error(`SKILL_RESOLUTION_${skillResolution.state.toUpperCase()}`)
    }
    const contextPackage = compileContext()
    const contextReference = await contextRepository.put(contextPackage)
    const executionPlan = compilePlan(contextPackage)
    const executionPlanReference = await planRepository.put(executionPlan)
    const request = executionRequest(profile, skill, projectState, contextPackage)
    const client = new ControlPlaneClient({
      baseUrl: 'http://127.0.0.1:43199',
      credential: 'agent-hq-service-token',
      fetch: async (url, init) => {
        const body = JSON.parse(String(init.body))
        const path = new globalThis.URL(url).pathname
        const requiredScope = {
          '/v1/profiles/resolve': 'profile:resolve',
          '/v1/project-states/resolve': 'project-state:resolve',
          '/v1/context-packages/resolve': 'context-package:resolve',
          '/v1/executions/validate': 'execution:validate',
        }[path]
        if (!requiredScope) throw new Error(`UNEXPECTED_PUBLIC_SDK_PATH:${path}`)
        await authenticate({
          body,
          requiredScopes: [requiredScope],
          token: String(init.headers.authorization).replace(/^Bearer /, ''),
        })
        const data = await publicResponseData(path, body, {
          catalog,
          catalogRepository,
          contextReference,
          contextRepository,
          executionPlanReference,
          planRepository,
          projectStateService,
        })
        return globalThis.Response.json(
          {
            contractVersion: responseContractVersion,
            requestId: body.requestId,
            correlation: body.correlation,
            data,
          },
          { status: 200 }
        )
      },
    })
    const invoke = (path, operation, input) => {
      mutatePublicRequest(path, input)
      return operation(input)
    }
    const profileResponse = await invoke(
      '/v1/profiles/resolve',
      (input) => client.resolveProfile(input),
      profileRequest(profile)
    )
    const projectStateResponse = await invoke(
      '/v1/project-states/resolve',
      (input) => client.resolveProjectState(input),
      projectStateRequest(projectState)
    )
    const contextPackageResponse = await invoke(
      '/v1/context-packages/resolve',
      (input) => client.resolveContextPackage(input),
      contextPackageRequest(contextPackage)
    )
    const response = await invoke(
      '/v1/executions/validate',
      (input) => client.validateExecutionRequest(input),
      request
    )
    return {
      contextPackage,
      contextPackageResponse,
      contextReference,
      executionPlan,
      executionPlanReference,
      principal,
      profile: profileResolution.version,
      profileResponse,
      projectState,
      projectStateResponse,
      response,
      skill: skillResolution.version,
    }
  }

  return {
    authenticate,
    catalog,
    compileContext,
    compilePlan,
    contextRepository,
    dispatchAfter,
    get dispatches() {
      return dispatchAttempts.length
    },
    logs,
    planRepository,
    profile,
    projectState,
    runtimeDispatch,
    serviceClaims,
    skill,
    submitIntent,
  }
}

async function seedCatalog(catalog) {
  await catalog.createAgentProfile({
    profileId: coreAcceptanceIds.profileId,
    displayName: 'Core acceptance coordinator',
    ownership: { scope: 'workspace', workspaceId: coreAcceptanceIds.workspaceId },
    createdAt,
  })
  await catalog.createSkill({
    skillId: coreAcceptanceIds.skillId,
    displayName: 'Read project context',
    ownership: { scope: 'system' },
    createdAt,
  })
  await catalog.createAgentProfile({
    profileId: coreAcceptanceIds.foreignProfileId,
    displayName: 'Foreign workspace profile',
    ownership: { scope: 'workspace', workspaceId: coreAcceptanceIds.foreignWorkspaceId },
    createdAt,
  })
  const skillDraft = await catalog.createSkillDraft({
    skillId: coreAcceptanceIds.skillId,
    skillVersionId: coreAcceptanceIds.skillVersionId,
    manifest: {
      schemaVersion: 1,
      semanticVersion: '1.0.0',
      requiredCapabilities: ['filesystem.read'],
      requiredTools: [{ toolId: 'project-files', versionRange: '^1.0.0' }],
      compatibleProfileSchemaVersions: [1],
      compatibleContractMajorVersions: [1],
      evalRefs: ['artifact://core-acceptance/read-context/v1'],
    },
    content: { instructions: 'Read only the pinned project context.', artifactRefs: [] },
    createdAt,
  })
  const skill = await catalog.publishSkillVersion({
    skillVersionId: skillDraft.skillVersionId,
    expectedRevision: skillDraft.revision,
    publishedAt,
  })
  const profileDraft = await catalog.createAgentProfileDraft({
    profileId: coreAcceptanceIds.profileId,
    profileVersionId: coreAcceptanceIds.profileVersionId,
    version: 1,
    definition: {
      schemaVersion: 1,
      roleInstructions: 'Compile the execution configuration without dispatching it.',
      personaInstructions: 'Be deterministic and evidence-led.',
      skills: [
        {
          skillId: skill.skillId,
          skillVersionId: skill.skillVersionId,
          contentDigest: skill.manifest.contentDigest,
        },
      ],
      capabilityRequirements: ['filesystem.read'],
      executionConstraints: coreExecutionConstraints(),
      outputContractRefs: [outputContractRef],
    },
    createdAt,
  })
  const profile = await catalog.publishAgentProfileVersion({
    profileVersionId: profileDraft.profileVersionId,
    expectedRevision: profileDraft.revision,
    publishedAt,
  })
  return { profile, skill }
}

function authenticationEnvelope() {
  return globalThis.structuredClone(ControlApiFixtures.authentication.request)
}

function executionRequest(profile, skill, projectState, contextPackage) {
  const constraints = coreExecutionConstraints()
  return {
    ...globalThis.structuredClone(ControlApiFixtures.executionValidation.request),
    commandId: coreAcceptanceIds.commandId,
    requestId: coreAcceptanceIds.requestId,
    workspaceId: coreAcceptanceIds.workspaceId,
    projectId: coreAcceptanceIds.projectId,
    correlation: { traceId: coreAcceptanceIds.traceId },
    issuedAt: compiledAt,
    payload: {
      taskId: coreAcceptanceIds.taskId,
      agentId: coreAcceptanceIds.agentId,
      profileVersionId: profile.profileVersionId,
      skillVersionIds: [skill.skillVersionId],
      projectState: {
        workspaceId: projectState.workspaceId,
        projectId: projectState.projectId,
        revision: projectState.revision,
      },
      contextPackage: {
        contextPackageId: contextPackage.contextPackageId,
        contentDigest: contextPackage.contentDigest,
        schemaVersion: contextPackage.schemaVersion,
        compilerVersion: contextPackage.compiler.version,
      },
      policySnapshot: {
        policySnapshotId: constraints.policySnapshot.policyId,
        revision: constraints.policySnapshot.version,
        contentDigest: constraints.policySnapshot.digest,
      },
      runtimeRequirements: ['filesystem.read', 'stream.output'],
      outputContractRef,
    },
  }
}

function profileRequest(profile) {
  return {
    ...globalThis.structuredClone(ControlApiFixtures.profileResolution.request),
    parameters: {
      profileId: profile.profileId,
      profileVersionId: profile.profileVersionId,
    },
  }
}

function projectStateRequest(projectState) {
  return {
    ...globalThis.structuredClone(ControlApiFixtures.projectStateResolution.request),
    parameters: { revision: projectState.revision },
  }
}

function contextPackageRequest(contextPackage) {
  return {
    ...globalThis.structuredClone(ControlApiFixtures.contextPackageResolution.request),
    parameters: { contextPackageId: contextPackage.contextPackageId },
  }
}

async function publicResponseData(path, body, services) {
  if (path === '/v1/profiles/resolve') {
    const profile = await services.catalogRepository.getAgentProfile(body.parameters.profileId)
    if (
      !profile ||
      (profile.ownership.scope === 'workspace' &&
        profile.ownership.workspaceId !== body.workspaceId)
    ) {
      throw new Error('PROFILE_SCOPE_MISMATCH')
    }
    const resolved = await services.catalog.resolveAgentProfile({
      profileId: body.parameters.profileId,
      profileVersionId: body.parameters.profileVersionId,
    })
    if (resolved.state !== 'available') throw new Error(`PROFILE_${resolved.state.toUpperCase()}`)
    return {
      profile: {
        profileId: resolved.version.profileId,
        profileVersionId: resolved.version.profileVersionId,
        version: resolved.version.version,
        revision: resolved.version.revision,
        schemaVersion: resolved.version.definition.schemaVersion,
        contentDigest: resolved.version.contentDigest,
        lifecycle: 'published',
      },
      skillVersionIds: resolved.version.definition.skills.map((skill) => skill.skillVersionId),
    }
  }
  if (path === '/v1/project-states/resolve') {
    const projectState = await services.projectStateService.getAtRevision({
      workspaceId: body.workspaceId,
      projectId: body.projectId,
      revision: body.parameters.revision,
    })
    return {
      projectState: {
        workspaceId: projectState.workspaceId,
        projectId: projectState.projectId,
        revision: projectState.revision,
      },
    }
  }
  if (path === '/v1/context-packages/resolve') {
    if (body.parameters.contextPackageId !== services.contextReference.contextPackageId) {
      throw new Error('CONTEXT_PACKAGE_MISSING')
    }
    const contextPackage = await services.contextRepository.get(services.contextReference)
    if (
      !contextPackage ||
      contextPackage.projectState.workspaceId !== body.workspaceId ||
      contextPackage.projectState.projectId !== body.projectId
    ) {
      throw new Error('CONTEXT_PACKAGE_SCOPE_MISMATCH')
    }
    return {
      contextPackage: {
        contextPackageId: contextPackage.contextPackageId,
        contentDigest: contextPackage.contentDigest,
        schemaVersion: contextPackage.schemaVersion,
        compilerVersion: contextPackage.compiler.version,
      },
    }
  }
  const executionPlan = await services.planRepository.get(services.executionPlanReference)
  if (!executionPlan) throw new Error('EXECUTION_PLAN_MISSING')
  const contextPackage = await services.contextRepository.get({
    contextPackageId: executionPlan.contextPackage.contextPackageId,
    contentDigest: executionPlan.contextPackage.contentDigest,
  })
  if (!contextPackage) throw new Error('EXECUTION_CONTEXT_PACKAGE_MISSING')
  assertRequestPins(body, executionPlan, contextPackage)
  return { valid: true, executionPlan: services.executionPlanReference }
}

function assertRequestPins(body, executionPlan, contextPackage) {
  if (
    body.workspaceId !== executionPlan.correlation.workspaceId ||
    body.projectId !== executionPlan.correlation.projectId ||
    body.payload.profileVersionId !== executionPlan.profile.profileVersionId ||
    body.payload.skillVersionIds.length !== executionPlan.skills.length ||
    body.payload.skillVersionIds.some(
      (skillVersionId, index) => skillVersionId !== executionPlan.skills[index]?.skillVersionId
    ) ||
    body.payload.projectState.workspaceId !== executionPlan.correlation.workspaceId ||
    body.payload.projectState.projectId !== executionPlan.correlation.projectId ||
    body.payload.projectState.revision !== contextPackage.projectState.revision ||
    body.payload.contextPackage.contextPackageId !==
      executionPlan.contextPackage.contextPackageId ||
    body.payload.contextPackage.contentDigest !== executionPlan.contextPackage.contentDigest ||
    body.payload.policySnapshot.contentDigest !== executionPlan.policySnapshot.digest
  ) {
    throw new Error('PUBLIC_INTENT_PIN_MISMATCH')
  }
}

function serviceClaims(overrides = {}) {
  return {
    audience: 'control-plane',
    credentialId: 'credential-agent-hq-core-acceptance',
    credentialKind: 'service',
    expiresAt: '2026-08-23T18:00:00.000Z',
    issuedAt: createdAt,
    issuer: 'https://agent-hq.example',
    keyId: 'agent-hq-core-acceptance',
    principalId: 'svc_agent-hq',
    projectIds: [coreAcceptanceIds.projectId],
    scopes: [
      'system:authenticate',
      'profile:resolve',
      'project-state:resolve',
      'context-package:resolve',
      'execution:validate',
    ],
    workspaceIds: [coreAcceptanceIds.workspaceId],
    ...overrides,
  }
}

function coreExecutionConstraints() {
  const constraints = globalThis.structuredClone(executionConstraintFixtures.readOnly)
  constraints.runtime.allowedFamilies = ['mock']
  return constraints
}

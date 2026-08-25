import { describe, expect, test } from 'bun:test'
import { TextEncoder } from 'node:util'
import { contextPackageSerializationFixtures } from '@control-plane/context'
import { CredentialVault, InMemorySecretProvider } from '@control-plane/credential-vault'
import {
  InMemoryInteractionRepository,
  InteractionService,
  executionConstraintFixtures,
} from '@control-plane/domain'
import { ExecutionPlanCompiler } from '@control-plane/execution-plan'
import {
  FakeModelAdapter,
  ManagedModelGateway,
  ModelRouteRegistry,
} from '@control-plane/model-gateway'
import {
  FakeArtifactPromoter,
  FakeSandboxProvider,
  SandboxCoordinator,
} from '@control-plane/sandbox'
import { InMemoryUsageLedger } from '@control-plane/usage-ledger'
import {
  FakeToolExecutor,
  InMemoryToolCallRepository,
  InMemoryToolRateLimiter,
  InMemoryToolRegistryRepository,
  InteractionToolApprovalCoordinator,
  PolicyControlledToolExecutionService,
  StaticToolPolicyAuthorizer,
  ToolGateway,
  ToolRegistry,
} from '../apps/tool-gateway/dist/index.js'

const digest = (character) => `sha256:${character.repeat(64)}`
const secret = 'M7-SECRET-TAINT-9f4a'
const ids = {
  workspaceId: 'wsp_01JABCDEF0123456789ABCDEFG',
  projectId: 'prj_01JABCDEF0123456789ABCDEFG',
  taskId: 'tsk_01JABCDEF0123456789ABCDEFG',
  agentId: 'agt_01JABCDEF0123456789ABCDEFG',
  profileId: 'prf_01JABCDEF0123456789ABCDEFG',
  profileVersionId: 'pfv_01JABCDEF0123456789ABCDEFG',
  skillId: 'skl_01JABCDEF0123456789ABCDEFG',
  skillVersionId: 'skv_01JABCDEF0123456789ABCDEFG',
  requestId: 'req_01JABCDEF0123456789ABCDEFG',
  executionId: 'exe_01JABCDEF0123456789ABCDEFG',
  attemptId: 'att_01JABCDEF0123456789ABCDEFG',
  traceId: 'trc_01JABCDEF0123456789ABCDEFG',
  modelCallId: 'mdc_01JABCDEF0123456789ABCDEFG',
  toolDefinitionId: 'tld_01JABCDEF0123456789ABCDEFG',
  toolVersionId: 'tlv_01JABCDEF0123456789ABCDEFG',
  toolCallId: 'tlc_01JABCDEF0123456789ABCDEFG',
  interactionId: 'int_01JABCDEF0123456789ABCDEFG',
  credentialId: 'crd_01JABCDEF0123456789ABCDEFG',
  credentialLeaseId: 'crl_01JABCDEF0123456789ABCDEFG',
}
const policySnapshot = {
  policyId: 'workspace-standard',
  version: 7,
  digest: digest('a'),
}
const allowPdp = {
  async authorize(input) {
    return {
      effect: 'allow',
      decisionId: digest('b'),
      reasonCode: 'CEDAR_PERMIT',
      policySnapshot: input.policySnapshot,
      evaluatedAt: input.context.requestedAt,
    }
  },
}

describe('M7 tools, models, credentials, sandbox, and budget acceptance', () => {
  test('runs one policy-controlled managed execution and settles every effect once', async () => {
    const plan = compilePlan()
    expect(plan).toMatchObject({
      constraints: {
        tools: { grants: expect.any(Array) },
        models: expect.any(Array),
        limits: { budget: expect.any(Object), sandbox: expect.any(Object) },
      },
      policySnapshot: executionConstraintFixtures.write.policySnapshot,
    })

    const vault = await credentialVault()
    const lease = await vault.lease(leaseRequest())
    const model = modelGateway()
    const modelResult = await model.gateway.complete(modelRequest())

    const tools = await toolService(async () =>
      vault.use(
        lease.capabilityRef,
        {
          workspaceId: ids.workspaceId,
          operation: 'records.write',
          resourceRef: 'tool:records',
        },
        async (value) => ({ saved: value === secret })
      )
    )
    expect(await tools.service.execute(toolRequest())).toMatchObject({ state: 'awaiting_approval' })
    await new InteractionService(tools.interactions).respond({
      interactionId: ids.interactionId,
      executionId: ids.executionId,
      attemptId: ids.attemptId,
      responseId: 'cmd_01JABCDEF0123456789ABCDEFG',
      action: 'approve',
      respondingPrincipalId: 'svc_agent-hq',
      expectedVersion: 1,
      respondedAt: '2026-08-25T12:01:00.000Z',
    })
    const toolResult = await tools.service.execute(toolRequest())
    expect(await tools.service.execute(toolRequest())).toEqual(toolResult)
    expect(tools.executor.requests).toHaveLength(1)

    const provider = new FakeSandboxProvider({ now: () => '2026-08-25T12:00:00.000Z' })
    const promoter = new FakeArtifactPromoter()
    promoter.authorized = true
    const sandbox = new SandboxCoordinator({ provider, promoter })
    const handle = await sandbox.create(sandboxRequest())
    await sandbox.upload({
      sandboxId: handle.sandboxId,
      path: '/workspace/result.json',
      content: new TextEncoder().encode('{"ok":true}'),
    })
    const artifact = await sandbox.promote({
      sandboxId: handle.sandboxId,
      path: '/workspace/result.json',
    })

    const ledger = usageLedger()
    const modelCharge = charge(
      ledger,
      'model_usage',
      'model-effect',
      'tokens',
      modelResult.usage.totalTokens,
      300_000
    )
    expect(
      charge(
        ledger,
        'model_usage',
        'model-effect',
        'tokens',
        modelResult.usage.totalTokens,
        300_000
      )
    ).toEqual(modelCharge)
    const toolCharge = charge(ledger, 'tool_charge', 'tool-effect', 'calls', 1, 100_000)
    expect(charge(ledger, 'tool_charge', 'tool-effect', 'calls', 1, 100_000)).toEqual(toolCharge)
    const sandboxCharge = charge(
      ledger,
      'sandbox_usage',
      'sandbox-effect',
      'milliseconds',
      25,
      100_000
    )
    expect(charge(ledger, 'sandbox_usage', 'sandbox-effect', 'milliseconds', 25, 100_000)).toEqual(
      sandboxCharge
    )
    const settlement = ledger.settle({
      executionId: ids.executionId,
      reservationKey: 'managed-execution',
      source: { sourceId: 'settlement', idempotencyKey: 'settlement' },
    })

    expect(artifact.locator).toBe('artifact://sandbox/report')
    expect(ledger.summary(ids.executionId)).toMatchObject({
      spentMicrounits: 500_000,
      reservedMicrounits: 0,
      settled: true,
    })
    expect(
      ledger
        .entries(ids.executionId)
        .filter((entry) => ['model_usage', 'tool_charge', 'sandbox_usage'].includes(entry.kind))
    ).toHaveLength(3)
    expect(
      ledger.settle({
        executionId: ids.executionId,
        reservationKey: 'managed-execution',
        source: { sourceId: 'settlement', idempotencyKey: 'settlement' },
      })
    ).toEqual(settlement)
    expect(
      JSON.stringify({
        plan,
        modelResult,
        toolResult,
        artifact,
        ledger: ledger.publicSummary(ids.executionId),
      })
    ).not.toContain(secret)
  })

  test('fails closed for policy, credential, schema, provider, sandbox, and budget faults', async () => {
    const denied = await toolService(async () => ({ saved: true }), 'deny')
    expect(await denied.service.execute(toolRequest())).toMatchObject({ state: 'denied' })
    expect(denied.executor.requests).toHaveLength(0)

    const evaluatorFailure = await toolService(async () => ({ saved: true }), 'allow', {
      authorize: async () => {
        throw new Error('evaluator unavailable')
      },
    })
    await expect(evaluatorFailure.service.execute(toolRequest())).rejects.toMatchObject({
      code: 'POLICY_EVALUATION_FAILED',
    })
    expect(evaluatorFailure.executor.requests).toHaveLength(0)

    const vault = await credentialVault()
    await vault.revoke(ids.credentialId, 'operator:security')
    await expect(vault.lease(leaseRequest())).rejects.toMatchObject({ code: 'CREDENTIAL_REVOKED' })

    const tools = await toolService(async () => ({ saved: true }))
    await expect(
      tools.service.execute(toolRequest({ toolVersionId: 'tlv_01JABCDEF0123456789ABCDEFH' }))
    ).rejects.toBeDefined()
    expect(tools.executor.requests).toHaveLength(0)

    const model = modelGateway()
    model.adapter.errorsByDeployment.set('managed.reasoning.primary', {
      code: 'OVERLOADED',
      retryable: true,
    })
    expect(await model.gateway.complete(modelRequest())).toMatchObject({
      route: { deploymentId: 'managed.reasoning.backup' },
    })
    model.registry.setHealth('managed.reasoning.backup', 'unhealthy')
    await expect(
      model.gateway.complete(modelRequest({ modelCallId: 'mdc_01JABCDEF0123456789ABCDEFH' }))
    ).rejects.toMatchObject({ code: 'PROVIDER_FAILED' })

    const sandboxProvider = new FakeSandboxProvider()
    sandboxProvider.nextExecution = 'timeout'
    const sandbox = new SandboxCoordinator({
      provider: sandboxProvider,
      promoter: new FakeArtifactPromoter(),
    })
    const handle = await sandbox.create(sandboxRequest())
    await expect(
      sandbox.execute({
        sandboxId: handle.sandboxId,
        command: ['run'],
        environment: {},
        timeoutMs: 10,
      })
    ).rejects.toMatchObject({ code: 'TIMEOUT' })
    expect(sandboxProvider.destroyed).toHaveLength(1)

    const networkProvider = new FakeSandboxProvider()
    const networkSandbox = new SandboxCoordinator({
      provider: networkProvider,
      promoter: new FakeArtifactPromoter(),
    })
    const networkHandle = await networkSandbox.create(sandboxRequest())
    await expect(
      networkSandbox.execute({
        sandboxId: networkHandle.sandboxId,
        command: ['curl', 'http://169.254.169.254/latest/meta-data'],
        environment: {},
        timeoutMs: 10,
      })
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' })

    const ledger = usageLedger()
    expect(() => charge(ledger, 'model_usage', 'over-budget', 'tokens', 100, 1_000_001)).toThrow(
      'BUDGET_EXHAUSTED'
    )
  })
})

function compilePlan() {
  const constraints = globalThis.structuredClone(executionConstraintFixtures.write)
  const skill = {
    skillVersionId: ids.skillVersionId,
    skillId: ids.skillId,
    revision: 4,
    lifecycle: 'published',
    manifest: {
      schemaVersion: 1,
      semanticVersion: '2.1.0',
      contentDigest: digest('d'),
      requiredCapabilities: ['filesystem.read'],
      requiredTools: [{ toolId: 'project-files', versionRange: '^1.0.0' }],
      compatibleProfileSchemaVersions: [1],
      compatibleContractMajorVersions: [1],
    },
    content: { instructions: 'Use bounded managed capabilities.', artifactRefs: [] },
    createdAt: '2026-08-25T11:00:00.000Z',
    lifecycleMetadata: { publishedAt: '2026-08-25T11:00:00.000Z' },
  }
  return new ExecutionPlanCompiler('1.0.0').compile({
    correlation: {
      workspaceId: ids.workspaceId,
      projectId: ids.projectId,
      taskId: ids.taskId,
      agentId: ids.agentId,
      requestId: ids.requestId,
    },
    profile: {
      profileVersionId: ids.profileVersionId,
      profileId: ids.profileId,
      version: 1,
      revision: 1,
      lifecycle: 'published',
      contentDigest: digest('c'),
      definition: {
        schemaVersion: 1,
        roleInstructions: 'Complete the task safely.',
        skills: [
          { skillId: ids.skillId, skillVersionId: ids.skillVersionId, contentDigest: digest('d') },
        ],
        capabilityRequirements: ['filesystem.read'],
        executionConstraints: constraints,
        outputContractRefs: ['contract://execution-result/v1'],
      },
      createdAt: '2026-08-25T11:00:00.000Z',
      lifecycleMetadata: { publishedAt: '2026-08-25T11:00:00.000Z' },
    },
    skills: [skill],
    contextPackage: globalThis.structuredClone(contextPackageSerializationFixtures.futurePi),
    constraints,
    requestConstraints: [],
    runtimeRequirements: [
      { capability: 'stream.output', necessity: 'required', minimumSupport: 'supported' },
    ],
    outputContract: { contractRef: 'contract://execution-result/v1' },
    compiledAt: '2026-08-25T12:00:00.000Z',
  })
}

async function credentialVault() {
  const vault = new CredentialVault({
    provider: new InMemorySecretProvider(),
    decisionPoint: allowPdp,
    now: () => '2026-08-25T12:00:00.000Z',
  })
  await vault.create({
    credentialId: ids.credentialId,
    workspaceId: ids.workspaceId,
    connectorRef: 'connector:records',
    provider: 'records',
    secret,
    createdAt: '2026-08-25T12:00:00.000Z',
  })
  return vault
}

function leaseRequest() {
  return {
    credentialLeaseId: ids.credentialLeaseId,
    credentialId: ids.credentialId,
    requestId: ids.requestId,
    workspaceId: ids.workspaceId,
    principalRef: 'service:tool-gateway',
    operation: 'records.write',
    resourceRef: 'tool:records',
    requestedAt: '2026-08-25T12:00:00.000Z',
    expiresAt: '2026-08-25T12:05:00.000Z',
    policySnapshot,
  }
}

function modelGateway() {
  const registry = new ModelRouteRegistry()
  const base = {
    alias: 'reasoning.standard',
    provider: 'openai',
    providerModel: 'gpt-5',
    providerClass: 'managed',
    dataResidency: 'us',
    capabilities: ['text_generation', 'reasoning'],
    adapterRef: 'fake-model',
    enabled: true,
    fundingSource: 'hq_managed',
    maxContextTokens: 128_000,
    maxOutputTokens: 8_192,
    costClass: 'standard',
    requiredEntitlements: ['models.managed'],
  }
  registry.register({
    ...base,
    deploymentId: 'managed.reasoning.primary',
    credentialRef: 'lease://primary',
    priority: 10,
  })
  registry.register({
    ...base,
    deploymentId: 'managed.reasoning.backup',
    credentialRef: 'lease://backup',
    priority: 20,
  })
  const adapter = new FakeModelAdapter()
  adapter.completion = {
    content: 'Use the approved tool and sandbox.',
    finishReason: 'stop',
    usage: { inputTokens: 10, outputTokens: 8 },
    providerRequestId: 'provider-request',
    latencyMs: 25,
  }
  return {
    registry,
    adapter,
    gateway: new ManagedModelGateway({
      registry,
      adapters: new Map([['fake-model', adapter]]),
      decisionPoint: allowPdp,
      now: () => '2026-08-25T12:00:00.000Z',
    }),
  }
}

function modelRequest(overrides = {}) {
  return {
    modelCallId: ids.modelCallId,
    requestId: ids.requestId,
    executionId: ids.executionId,
    attemptId: ids.attemptId,
    workspaceId: ids.workspaceId,
    principalRef: 'service:runtime-worker',
    alias: 'reasoning.standard',
    messages: [{ role: 'user', content: 'Complete the bounded task.' }],
    settings: { maxOutputTokens: 256, temperature: 0, timeoutMs: 1_000 },
    requirement: {
      alias: 'reasoning.standard',
      requiredCapabilities: ['text_generation'],
      providerPolicy: { allowedClasses: ['managed'], deniedProviders: [], dataResidency: ['us'] },
      fallback: 'same_alias',
    },
    policySnapshot,
    traceId: ids.traceId,
    fundingSource: 'hq_managed',
    routing: {
      entitlements: ['models.managed'],
      maxCostClass: 'standard',
      estimatedInputTokens: 64,
    },
    ...overrides,
  }
}

async function toolService(respond, effect = 'allow', authorizerOverride) {
  const registry = new ToolRegistry(new InMemoryToolRegistryRepository())
  await registry.createDefinition({
    toolDefinitionId: ids.toolDefinitionId,
    name: 'records.write',
    displayName: 'Write record',
    description: 'Writes one scoped record.',
    ownership: { scope: 'workspace', workspaceId: ids.workspaceId },
    createdAt: '2026-08-25T11:00:00.000Z',
  })
  await registry.publishVersion({
    toolVersionId: ids.toolVersionId,
    toolDefinitionId: ids.toolDefinitionId,
    semanticVersion: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: { saved: { type: 'boolean' } },
      required: ['saved'],
      additionalProperties: false,
    },
    operations: [
      {
        name: 'write',
        requiredCapabilities: ['records.write'],
        riskClass: 'high',
        approvalMode: 'always',
        idempotency: 'provider_key',
        retryPolicy: { maxAttempts: 1, retryableErrorCodes: [] },
      },
    ],
    executor: { type: 'connector', reference: 'records-v1' },
    limits: {
      maxInputBytes: 256,
      maxOutputBytes: 256,
      timeoutMs: 100,
      rateLimit: { maxCalls: 10, windowMs: 60_000 },
    },
    createdAt: '2026-08-25T11:00:00.000Z',
    publishedAt: '2026-08-25T11:00:00.000Z',
  })
  const executor = new FakeToolExecutor(respond)
  const gateway = new ToolGateway(registry)
  gateway.registerExecutor('connector', 'records-v1', executor)
  const interactions = new InMemoryInteractionRepository()
  return {
    executor,
    interactions,
    service: new PolicyControlledToolExecutionService({
      gateway,
      calls: new InMemoryToolCallRepository(),
      authorizer:
        authorizerOverride ??
        new StaticToolPolicyAuthorizer({
          effect,
          decisionId: 'decision-m7',
          policyVersion: 'workspace-v7',
          reasonCode: effect === 'allow' ? 'GRANTED' : 'POLICY_DENIED',
          requiresApproval: false,
          evaluatedAt: '2026-08-25T12:00:00.000Z',
        }),
      approvals: new InteractionToolApprovalCoordinator(
        new InteractionService(interactions),
        interactions
      ),
      rateLimiter: new InMemoryToolRateLimiter(),
    }),
  }
}

function toolRequest(overrides = {}) {
  return {
    toolCallId: ids.toolCallId,
    idempotencyKey: 'tool-effect-m7',
    requestedAt: '2026-08-25T12:00:00.000Z',
    policySnapshotRef: 'policy://workspace/v7',
    approval: {
      interactionId: ids.interactionId,
      allowedPrincipalIds: ['svc_agent-hq'],
      requestedAt: '2026-08-25T12:00:00.000Z',
      expiresAt: '2026-08-25T13:00:00.000Z',
    },
    requestId: ids.requestId,
    executionId: ids.executionId,
    attemptId: ids.attemptId,
    workspaceId: ids.workspaceId,
    profileId: ids.profileId,
    toolDefinitionId: ids.toolDefinitionId,
    toolVersionId: ids.toolVersionId,
    operation: 'write',
    input: { value: 'approved' },
    grant: {
      workspaceId: ids.workspaceId,
      profileId: ids.profileId,
      toolDefinitionId: ids.toolDefinitionId,
      toolVersionId: ids.toolVersionId,
      operations: ['write'],
    },
    audit: { principalRef: 'service:runtime-worker', traceId: ids.traceId },
    ...overrides,
  }
}

function sandboxRequest() {
  return {
    workspaceId: ids.workspaceId,
    executionId: ids.executionId,
    attemptId: ids.attemptId,
    policy: {
      template: 'node-24',
      timeoutMs: 1_000,
      limits: { cpuCount: 1, memoryMb: 512, storageMb: 512, outputBytes: 4_096 },
      network: { mode: 'deny_all' },
    },
  }
}

function usageLedger() {
  const ledger = new InMemoryUsageLedger({ now: () => '2026-08-25T12:00:00.000Z' })
  ledger.openBudget({
    workspaceId: ids.workspaceId,
    executionId: ids.executionId,
    currency: 'USD',
    maximumMicrounits: 1_000_000,
    maximumTokens: 1_000,
    source: { sourceId: 'execution', idempotencyKey: 'budget' },
  })
  ledger.reserve({
    workspaceId: ids.workspaceId,
    executionId: ids.executionId,
    attemptId: ids.attemptId,
    reservationKey: 'managed-execution',
    maximumMicrounits: 1_000_000,
    source: { sourceId: 'execution', idempotencyKey: 'reservation' },
  })
  return ledger
}

function charge(ledger, kind, key, unit, value, costMicrounits) {
  return ledger.charge({
    workspaceId: ids.workspaceId,
    executionId: ids.executionId,
    attemptId: ids.attemptId,
    reservationKey: 'managed-execution',
    kind,
    source: { sourceId: key, idempotencyKey: key },
    quantity: { unit, value },
    costMicrounits,
    fundingSource: 'hq_managed',
  })
}

import { describe, expect, test } from 'bun:test'
import { McpAdapter, McpAdapterError } from './mcp-adapter.ts'
import {
  InMemoryToolRegistryRepository,
  ToolGateway,
  ToolGatewayError,
  ToolRegistry,
} from './tool-registry.ts'
import {
  InMemoryToolCallRepository,
  InMemoryToolRateLimiter,
  PolicyControlledToolExecutionService,
  StaticToolPolicyAuthorizer,
} from './tool-execution.ts'

const ids = {
  workspace: 'wsp_01JABCDEF0123456789ABCDEFG',
  profile: 'prf_01JABCDEF0123456789ABCDEFG',
  execution: 'exe_01JABCDEF0123456789ABCDEFG',
  attempt: 'att_01JABCDEF0123456789ABCDEFG',
  request: 'req_01JABCDEF0123456789ABCDEFG',
  trace: 'trc_01JABCDEF0123456789ABCDEFG',
  call: 'tlc_01JABCDEF0123456789ABCDEFG',
}

const schemas = {
  input: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: { forecast: { type: 'string' } },
    required: ['forecast'],
    additionalProperties: false,
  },
}

class FakeMcpClient {
  enforcesRawDiscoveryLimit = true
  connected = true
  discoveryLimits = []
  tools = [
    {
      name: 'weather_lookup',
      description: 'Looks up weather.',
      version: '2026-08',
      inputSchema: schemas.input,
      outputSchema: schemas.output,
      readOnly: true,
    },
  ]
  calls = []
  async discover(_registration, limits) {
    if (!this.connected) throw Object.assign(new Error('offline'), { code: 'MCP_DISCONNECTED' })
    this.discoveryLimits.push(clone(limits))
    return clone(this.tools)
  }
  async invoke(request) {
    if (!this.connected) throw Object.assign(new Error('offline'), { code: 'MCP_DISCONNECTED' })
    this.calls.push(clone(request))
    return { forecast: 'sunny' }
  }
}

const clone = (value) => JSON.parse(JSON.stringify(value))

function makeIds() {
  let value = 0
  const suffixes = ['G', 'H', 'J', 'K', 'M', 'N', 'P', 'Q']
  return {
    definition: () => `tld_01JABCDEF0123456789ABCDEF${suffixes[value++]}`,
    version: () => `tlv_01JABCDEF0123456789ABCDEF${suffixes[value++]}`,
  }
}

function unrefreshedFixture() {
  const client = new FakeMcpClient()
  const registry = new ToolRegistry(new InMemoryToolRegistryRepository())
  const gateway = new ToolGateway(registry)
  const adapter = new McpAdapter({
    registration: { serverId: 'weather', credentialRef: 'vault://mcp/weather' },
    workspaceId: ids.workspace,
    client,
    registry,
    gateway,
    ids: makeIds(),
    limits: { maxInputBytes: 1_048_576, maxOutputBytes: 1_048_576, timeoutMs: 10 },
    now: () => '2026-08-25T08:00:00.000Z',
  })
  return { adapter, client, gateway, registry }
}

async function fixture() {
  const base = unrefreshedFixture()
  const { adapter, client, gateway, registry } = base
  const [version] = await adapter.refresh()
  const request = {
    requestId: ids.request,
    executionId: ids.execution,
    attemptId: ids.attempt,
    workspaceId: ids.workspace,
    profileId: ids.profile,
    toolDefinitionId: version.toolDefinitionId,
    toolVersionId: version.toolVersionId,
    operation: 'invoke',
    input: { city: 'San Juan' },
    grant: {
      workspaceId: ids.workspace,
      profileId: ids.profile,
      toolDefinitionId: version.toolDefinitionId,
      toolVersionId: version.toolVersionId,
      operations: ['invoke'],
    },
    audit: { principalRef: 'service:runtime-worker', traceId: ids.trace },
  }
  return { adapter, client, gateway, registry, request, version }
}

describe('MCP adapter', () => {
  test('imports canonical definitions with immutable source provenance and invokes only through Tool Gateway', async () => {
    const { client, gateway, registry, request, version } = await fixture()
    expect(version.source).toMatchObject({
      kind: 'mcp',
      serverId: 'weather',
      sourceToolName: 'weather_lookup',
      sourceToolVersion: '2026-08',
    })
    expect(client.discoveryLimits).toEqual([{ maxResponseBytes: 1_048_576 }])
    expect(JSON.stringify(await registry.list(ids.workspace))).not.toContain('vault://')
    const authorizer = new StaticToolPolicyAuthorizer({
      effect: 'allow',
      decisionId: 'mcp-allow-1',
      policyVersion: 'workspace-v7',
      reasonCode: 'GRANTED',
      requiresApproval: false,
      evaluatedAt: '2026-08-25T08:00:00.000Z',
    })
    const service = new PolicyControlledToolExecutionService({
      gateway,
      calls: new InMemoryToolCallRepository(),
      authorizer,
      approvals: {
        review: async () => {
          throw new Error('approval not expected')
        },
      },
      rateLimiter: new InMemoryToolRateLimiter(),
    })
    await expect(
      service.execute({
        ...request,
        toolCallId: ids.call,
        idempotencyKey: 'mcp-call-0001',
        requestedAt: '2026-08-25T08:00:00.000Z',
        policySnapshotRef: 'policy://workspace/v7',
      })
    ).resolves.toMatchObject({
      state: 'succeeded',
      result: { output: { forecast: 'sunny' }, toolVersionId: version.toolVersionId },
    })
    expect(authorizer.requests).toHaveLength(1)
    expect(client.calls).toEqual([
      {
        serverId: 'weather',
        toolName: 'weather_lookup',
        input: { city: 'San Juan' },
        credentialRef: 'vault://mcp/weather',
      },
    ])
  })

  test('publishes schema drift as a new version without mutating the pinned version', async () => {
    const { adapter, client, gateway, registry, request, version } = await fixture()
    const pinned = await gateway.prepare(request)
    client.tools[0].inputSchema = {
      ...schemas.input,
      properties: { ...schemas.input.properties, units: { type: 'string' } },
    }
    const [replacement] = await adapter.refresh()
    expect(replacement.toolVersionId).not.toBe(version.toolVersionId)
    expect(replacement.semanticVersion).toBe('0.0.2')
    expect((await registry.readVersion(version.toolVersionId, ids.workspace)).contentDigest).toBe(
      version.contentDigest
    )
    expect(replacement.source.schemaDigest).not.toBe(version.source.schemaDigest)
    await expect(gateway.invoke(pinned)).rejects.toMatchObject({
      code: 'EXECUTION_FAILED',
      executorCode: 'MCP_SCHEMA_CHANGED',
    })
  })

  test('publishes authority metadata drift as a new approval-bearing version', async () => {
    const { adapter, client, version } = await fixture()
    client.tools[0].readOnly = false
    client.tools[0].capabilities = ['network.write']

    const [replacement] = await adapter.refresh()
    expect(replacement.toolVersionId).not.toBe(version.toolVersionId)
    expect(replacement.source.schemaDigest).not.toBe(version.source.schemaDigest)
    expect(replacement.operations).toEqual([
      {
        name: 'invoke',
        requiredCapabilities: ['network.write'],
        riskClass: 'medium',
        approvalMode: 'always',
        idempotency: 'none',
      },
    ])
  })

  test('marks removed and disconnected tools unavailable and normalizes protocol failures', async () => {
    const { adapter, client, gateway, request } = await fixture()
    client.tools = []
    await adapter.refresh()
    await expect(gateway.execute(request)).rejects.toMatchObject({
      code: 'EXECUTION_FAILED',
      executorCode: 'MCP_TOOL_REMOVED',
    })

    client.connected = false
    await expect(adapter.refresh()).rejects.toBeInstanceOf(McpAdapterError)
    await expect(gateway.execute(request)).rejects.toMatchObject({
      code: 'EXECUTION_FAILED',
      executorCode: 'MCP_DISCONNECTED',
    })
  })

  test('keeps credentials out of canonical and execution payloads and enforces output bounds', async () => {
    const { client, gateway, request, version } = await fixture()
    expect(JSON.stringify({ request, version })).not.toContain('vault://')
    client.invoke = async () => ({ forecast: 'x'.repeat(2_000_000) })
    await expect(gateway.execute(request)).rejects.toBeInstanceOf(ToolGatewayError)
    await expect(gateway.execute(request)).rejects.toMatchObject({ code: 'OUTPUT_LIMIT_EXCEEDED' })
  })

  test('normalizes MCP protocol errors and applies the pinned gateway timeout', async () => {
    const { client, gateway, request } = await fixture()
    client.invoke = async () => {
      throw Object.assign(new Error('bad frame'), { code: 'MCP_PROTOCOL_ERROR' })
    }
    await expect(gateway.execute(request)).rejects.toMatchObject({
      code: 'EXECUTION_FAILED',
      executorCode: 'MCP_PROTOCOL_ERROR',
    })
    let observedSignal
    client.invoke = async (_request, signal) => {
      observedSignal = signal
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }
    await expect(gateway.execute(request)).rejects.toMatchObject({
      code: 'EXECUTION_TIMEOUT',
      executorCode: 'TIMEOUT',
    })
    expect(observedSignal).toBeInstanceOf(globalThis.AbortSignal)
    expect(observedSignal.aborted).toBe(true)
  })

  test('rejects oversized MCP discovery catalogs before creating registry records', async () => {
    const { adapter, client, registry } = unrefreshedFixture()
    client.tools = Array.from({ length: 257 }, (_, index) => ({
      ...client.tools[0],
      name: `weather_${index}`,
    }))

    await expect(adapter.refresh()).rejects.toMatchObject({ code: 'MCP_DISCOVERY_FAILED' })
    expect(await registry.list(ids.workspace)).toEqual([])
  })

  test('rejects oversized and deeply nested MCP schemas before creating registry records', async () => {
    const oversized = unrefreshedFixture()
    oversized.client.tools[0].inputSchema = {
      type: 'object',
      description: 'x'.repeat(262_145),
    }
    await expect(oversized.adapter.refresh()).rejects.toMatchObject({
      code: 'MCP_DISCOVERY_FAILED',
    })
    expect(await oversized.registry.list(ids.workspace)).toEqual([])

    const deeplyNested = unrefreshedFixture()
    let schema = { type: 'string' }
    for (let depth = 0; depth < 33; depth += 1) schema = { items: schema }
    deeplyNested.client.tools[0].inputSchema = schema
    await expect(deeplyNested.adapter.refresh()).rejects.toMatchObject({
      code: 'MCP_DISCOVERY_FAILED',
    })
    expect(await deeplyNested.registry.list(ids.workspace)).toEqual([])
  })

  test('rejects oversized aggregate discovery metadata and capability lists atomically', async () => {
    const aggregate = unrefreshedFixture()
    aggregate.client.tools = Array.from({ length: 5 }, (_, index) => ({
      ...aggregate.client.tools[0],
      name: `weather_${index}`,
      inputSchema: { type: 'string', description: 'x'.repeat(120_000) },
      outputSchema: { type: 'string', description: 'y'.repeat(120_000) },
    }))
    await expect(aggregate.adapter.refresh()).rejects.toMatchObject({
      code: 'MCP_DISCOVERY_FAILED',
    })
    expect(await aggregate.registry.list(ids.workspace)).toEqual([])

    const capabilities = unrefreshedFixture()
    capabilities.client.tools[0].capabilities = Array.from(
      { length: 65 },
      (_, index) => `capability.${index}`
    )
    await expect(capabilities.adapter.refresh()).rejects.toMatchObject({
      code: 'MCP_DISCOVERY_FAILED',
    })
    expect(await capabilities.registry.list(ids.workspace)).toEqual([])
  })

  test('rejects invalid bounded metadata and accepts valid discovery at structural limits', async () => {
    for (const invalid of [
      { name: 'x'.repeat(257) },
      { description: '' },
      { description: 'x'.repeat(2_049) },
      { version: 'x'.repeat(129) },
      { capabilities: ['read files', 'read.files'] },
    ]) {
      const current = unrefreshedFixture()
      Object.assign(current.client.tools[0], invalid)
      await expect(current.adapter.refresh()).rejects.toMatchObject({
        code: 'MCP_DISCOVERY_FAILED',
      })
      expect(await current.registry.list(ids.workspace)).toEqual([])
    }

    const bounded = unrefreshedFixture()
    let schema = { type: 'string' }
    for (let depth = 1; depth < 30; depth += 1) schema = { type: 'array', items: schema }
    bounded.client.tools[0].inputSchema = schema
    bounded.client.tools[0].capabilities = Array.from(
      { length: 64 },
      (_, index) => `capability.${index}`
    )
    await expect(bounded.adapter.refresh()).resolves.toHaveLength(1)
  })

  test('keeps existing bindings available when a later discovery response exceeds limits', async () => {
    const { adapter, client, registry } = unrefreshedFixture()
    const [version] = await adapter.refresh()
    client.tools[0].inputSchema = { type: 'string', description: 'x'.repeat(262_145) }

    await expect(adapter.refresh()).rejects.toMatchObject({ code: 'MCP_DISCOVERY_FAILED' })
    expect(await registry.readVersion(version.toolVersionId, ids.workspace)).toMatchObject({
      toolVersionId: version.toolVersionId,
    })
  })

  test('keeps existing bindings available when replacement metadata is invalid', async () => {
    const { adapter, client, gateway, request } = await fixture()
    client.tools = [{ ...client.tools[0], name: 'replacement', description: '' }]

    await expect(adapter.refresh()).rejects.toMatchObject({ code: 'MCP_DISCOVERY_FAILED' })
    await expect(gateway.execute(request)).resolves.toMatchObject({
      output: { forecast: 'sunny' },
    })
  })

  test('validates every discovered schema before publishing any registry state', async () => {
    const { adapter, client, registry } = unrefreshedFixture()
    client.tools.push({
      ...client.tools[0],
      name: 'invalid_schema',
      inputSchema: { type: 'definitely-not-a-json-schema-type' },
    })

    await expect(adapter.refresh()).rejects.toMatchObject({ code: 'MCP_DISCOVERY_FAILED' })
    expect(await registry.list(ids.workspace)).toEqual([])
  })

  test('rejects MCP clients that do not enforce the raw discovery frame limit', () => {
    const client = new FakeMcpClient()
    client.enforcesRawDiscoveryLimit = false
    expect(
      () =>
        new McpAdapter({
          registration: { serverId: 'weather', credentialRef: 'vault://mcp/weather' },
          workspaceId: ids.workspace,
          client,
          registry: new ToolRegistry(new InMemoryToolRegistryRepository()),
          gateway: new ToolGateway(new ToolRegistry(new InMemoryToolRegistryRepository())),
          ids: makeIds(),
        })
    ).toThrow(new McpAdapterError('MCP_UNBOUNDED_CLIENT'))
  })
})

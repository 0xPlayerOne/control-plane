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
  connected = true
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
  async discover() {
    if (!this.connected) throw Object.assign(new Error('offline'), { code: 'MCP_DISCONNECTED' })
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

async function fixture() {
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
    client.invoke = async () => new Promise(() => {})
    await expect(gateway.execute(request)).rejects.toMatchObject({
      code: 'EXECUTION_TIMEOUT',
      executorCode: 'TIMEOUT',
    })
  })
})

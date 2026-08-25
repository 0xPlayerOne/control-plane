import { describe, expect, test } from 'bun:test'
import {
  FakeModelAdapter,
  LiteLlmAdapter,
  ManagedModelGateway,
  ModelGatewayError,
  ModelRouteRegistry,
} from './index.ts'

const ids = {
  call: 'mdc_01JABCDEF0123456789ABCDEFG',
  request: 'req_01JABCDEF0123456789ABCDEFG',
  execution: 'exe_01JABCDEF0123456789ABCDEFG',
  attempt: 'att_01JABCDEF0123456789ABCDEFG',
  workspace: 'wsp_01JABCDEF0123456789ABCDEFG',
  trace: 'trc_01JABCDEF0123456789ABCDEFG',
}
const snapshot = { policyId: 'workspace-standard', version: 1, digest: `sha256:${'a'.repeat(64)}` }
const requirement = {
  alias: 'reasoning.standard',
  requiredCapabilities: ['text_generation', 'reasoning'],
  providerPolicy: { allowedClasses: ['managed'], deniedProviders: [], dataResidency: ['us'] },
  fallback: 'same_alias',
}
const deployment = {
  deploymentId: 'managed.reasoning.us',
  alias: 'reasoning.standard',
  provider: 'openai',
  providerModel: 'gpt-5',
  providerClass: 'managed',
  dataResidency: 'us',
  capabilities: ['text_generation', 'reasoning', 'structured_output'],
  credentialRef: 'lease://model/openai',
  adapterRef: 'litellm-primary',
  enabled: true,
}
const request = (overrides = {}) => ({
  modelCallId: ids.call,
  requestId: ids.request,
  executionId: ids.execution,
  attemptId: ids.attempt,
  workspaceId: ids.workspace,
  principalRef: 'service:runtime-worker',
  alias: 'reasoning.standard',
  messages: [{ role: 'user', content: 'Summarize this.' }],
  settings: { maxOutputTokens: 256, temperature: 0.2, timeoutMs: 5_000 },
  requirement,
  policySnapshot: snapshot,
  traceId: ids.trace,
  fundingSource: 'hq_managed',
  ...overrides,
})
const allowPdp = {
  requests: [],
  async authorize(input) {
    this.requests.push(input)
    return {
      effect: 'allow',
      decisionId: `sha256:${'b'.repeat(64)}`,
      reasonCode: 'CEDAR_PERMIT',
      policySnapshot: input.policySnapshot,
      evaluatedAt: input.context.requestedAt,
    }
  },
}

async function fixture(adapter = new FakeModelAdapter()) {
  const registry = new ModelRouteRegistry()
  registry.register(deployment)
  adapter.completion = {
    content: 'A summary.',
    finishReason: 'stop',
    usage: { inputTokens: 12, outputTokens: 4, cachedInputTokens: 2, reasoningTokens: 1 },
    providerRequestId: 'provider-request-1',
    latencyMs: 42,
  }
  const gateway = new ManagedModelGateway({
    registry,
    adapters: new Map([['litellm-primary', adapter]]),
    decisionPoint: allowPdp,
    now: () => '2026-08-25T09:00:00.000Z',
  })
  return { gateway, registry, adapter }
}

describe('managed model gateway', () => {
  test('resolves a logical alias through plan and policy constraints with normalized usage', async () => {
    const { gateway, adapter } = await fixture()
    const result = await gateway.complete(request())
    expect(result).toMatchObject({
      modelCallId: ids.call,
      alias: 'reasoning.standard',
      content: 'A summary.',
      usage: {
        inputTokens: 12,
        outputTokens: 4,
        totalTokens: 16,
        cachedInputTokens: 2,
        reasoningTokens: 1,
      },
      provider: { name: 'openai', model: 'gpt-5', requestId: 'provider-request-1' },
      fundingSource: 'hq_managed',
      policySnapshot: snapshot,
    })
    expect(adapter.requests).toHaveLength(1)
    expect(allowPdp.requests.at(-1)).toMatchObject({
      action: 'model:invoke',
      resource: { type: 'model' },
      policySnapshot: snapshot,
    })
    expect(JSON.stringify({ request: adapter.requests[0].request, result })).not.toContain(
      'lease://model/openai'
    )
  })

  test('keeps LiteLLM and credential configuration server-side', async () => {
    const calls = []
    const client = {
      async complete(input) {
        calls.push(input)
        return {
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
          id: 'litellm-1',
          response_ms: 12,
        }
      },
      async health() {
        return { healthy: true, checkedAt: '2026-08-25T09:00:00.000Z' }
      },
      async cancel() {
        return true
      },
    }
    const adapter = new LiteLlmAdapter({ client })
    const { gateway } = await fixture(adapter)
    const result = await gateway.complete(request())
    expect(calls[0]).toMatchObject({ model: 'gpt-5', credentialRef: 'lease://model/openai' })
    expect(JSON.stringify(result)).not.toContain('credentialRef')
    expect(JSON.stringify(result)).not.toContain('lease://')
  })

  test('fails closed for unknown aliases and plan/provider/capability constraints', async () => {
    const { gateway, adapter } = await fixture()
    for (const invalid of [
      request({ alias: 'unknown.alias' }),
      request({ requirement: { ...requirement, requiredCapabilities: ['vision_input'] } }),
      request({
        requirement: {
          ...requirement,
          providerPolicy: { ...requirement.providerPolicy, deniedProviders: ['openai'] },
        },
      }),
      request({
        requirement: {
          ...requirement,
          providerPolicy: { ...requirement.providerPolicy, dataResidency: ['eu'] },
        },
      }),
      request({ settings: { maxOutputTokens: 500_000, temperature: 0.2, timeoutMs: 5_000 } }),
    ])
      await expect(gateway.complete(invalid)).rejects.toBeInstanceOf(ModelGatewayError)
    expect(adapter.requests).toHaveLength(0)
  })

  test('supports normalized streaming, health, and cancellation', async () => {
    const adapter = new FakeModelAdapter()
    adapter.streamChunks = [
      { delta: 'A ' },
      { delta: 'summary.', finishReason: 'stop', usage: { inputTokens: 3, outputTokens: 2 } },
    ]
    const { gateway } = await fixture(adapter)
    const chunks = []
    for await (const chunk of gateway.stream(request())) chunks.push(chunk)
    expect(chunks.at(-1)).toMatchObject({
      finishReason: 'stop',
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    })
    await expect(gateway.health('litellm-primary')).resolves.toMatchObject({ healthy: true })
    await expect(gateway.cancel(ids.call)).resolves.toBe(true)
  })

  test('normalizes gateway/provider failures without credentials or prompts', async () => {
    const adapter = new FakeModelAdapter()
    adapter.error = new Error('Authorization: Bearer super-secret Summarize this.')
    const { gateway } = await fixture(adapter)
    await expect(gateway.complete(request())).rejects.toMatchObject({
      code: 'PROVIDER_FAILED',
      message: 'PROVIDER_FAILED',
    })
  })
})

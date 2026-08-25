import { describe, expect, test } from 'bun:test'
import {
  SecretCanaryGuard,
  assertCredentialPurpose,
  findCredentialLeaks,
  runAuthorizationIsolationMatrix,
} from './index.ts'

describe('production security audit controls', () => {
  test('detects a canary across every prohibited serialization sink without echoing it', () => {
    const canary = 'M9-SECRET-CANARY-4bbf6b2a'
    const guard = new SecretCanaryGuard([canary])
    const safeSinks = {
      logs: { event: 'model.failed', reason: 'PROVIDER_FAILED' },
      traces: { 'execution.id': 'execution-1' },
      events: { kind: 'execution.failed', classification: 'provider' },
      errors: new Error('provider failed'),
      checkpoints: { state: 'waiting' },
      modelContext: { messages: [{ role: 'user', contentDigest: `sha256:${'1'.repeat(64)}` }] },
      publicApi: { status: 'failed', error: { code: 'PROVIDER_FAILED' } },
    }

    expect(() => guard.assertSafe(safeSinks)).not.toThrow()
    expect(() => guard.assertSafe({ ...safeSinks, traces: { authorization: canary } })).toThrow(
      'SECRET_CANARY_LEAK:traces'
    )
    try {
      guard.assertSafe({ logs: canary })
    } catch (error) {
      expect(String(error)).not.toContain(canary)
    }
  })

  test('requires credential purpose and audience without type substitution', () => {
    const service = {
      kind: 'service',
      audience: 'control-api',
      subject: 'agent-hq',
      workspaceId: 'workspace-1',
    }
    expect(assertCredentialPurpose(service, 'service', 'control-api')).toEqual(service)
    expect(() => assertCredentialPurpose(service, 'runtime_node', 'runtime-gateway')).toThrow(
      'CREDENTIAL_PURPOSE_MISMATCH'
    )
    expect(() =>
      assertCredentialPurpose({ ...service, audience: 'runtime-gateway' }, 'service', 'control-api')
    ).toThrow('CREDENTIAL_AUDIENCE_MISMATCH')
  })

  test('proves every cross-scope read and mutation denies without existence leakage', async () => {
    const matrix = await runAuthorizationIsolationMatrix({
      dimensions: ['workspace', 'project', 'profile', 'context', 'runtime', 'tool', 'usage'],
      operations: ['read', 'mutate'],
      probe: async ({ sameScope }) =>
        sameScope
          ? { allowed: true, publicCode: 'OK' }
          : { allowed: false, publicCode: 'RESOURCE_NOT_FOUND' },
    })

    expect(matrix).toHaveLength(28)
    expect(matrix.filter(({ sameScope }) => !sameScope).every(({ passed }) => passed)).toBe(true)
    expect(
      new Set(matrix.filter(({ sameScope }) => !sameScope).map(({ publicCode }) => publicCode))
    ).toEqual(new Set(['RESOURCE_NOT_FOUND']))
  })

  test('fails the isolation audit if a cross-scope probe leaks existence or grants access', async () => {
    await expect(
      runAuthorizationIsolationMatrix({
        dimensions: ['workspace'],
        operations: ['read'],
        probe: async ({ sameScope }) => ({
          allowed: !sameScope,
          publicCode: sameScope ? 'OK' : 'FORBIDDEN',
        }),
      })
    ).rejects.toThrow('AUTHORIZATION_ISOLATION_FAILED:workspace:read')
  })

  test('detects production credential formats without flagging placeholders', () => {
    const githubToken = ['ghp', '_', 'A'.repeat(36)].join('')
    const privateKey = ['-----BEGIN ', 'PRIVATE KEY-----'].join('')

    expect(findCredentialLeaks('config.ts', `token=${githubToken}\n${privateKey}`)).toEqual([
      { path: 'config.ts', rule: 'github-token' },
      { path: 'config.ts', rule: 'private-key' },
    ])
    expect(findCredentialLeaks('.env.example', 'API_KEY=replace-me\nTOKEN=example-token')).toEqual(
      []
    )
  })
})

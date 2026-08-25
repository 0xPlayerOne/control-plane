import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  CedarPolicyDecisionPoint,
  FakeCedarEvaluator,
  InMemoryPolicyStore,
  PolicyAuthorizationRequestSchema,
} from './index.ts'

const workspace = 'wsp_01JABCDEF0123456789ABCDEFG'
const otherWorkspace = 'wsp_01JABCDEF0123456789ABCDEFH'
const cedarA = 'permit(principal, action, resource);'
const cedarB = 'forbid(principal, action, resource);'
const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`
const digestA = digest(cedarA)
const digestB = digest(cedarB)

const request = (overrides = {}) => ({
  requestId: 'req_01JABCDEF0123456789ABCDEFG',
  principal: { type: 'service', id: 'service:runtime-worker', workspaceId: workspace },
  action: 'tool:invoke',
  resource: {
    type: 'tool',
    id: 'tlv_01JABCDEF0123456789ABCDEFG',
    workspaceId: workspace,
    attributes: { riskClass: 'low' },
  },
  context: { workspaceId: workspace, requestedAt: '2026-08-25T09:00:00.000Z' },
  policySnapshot: { policyId: 'workspace-standard', version: 1, digest: digestA },
  ...overrides,
})

async function fixture(
  rules = [
    { effect: 'permit', principalType: 'service', action: 'tool:invoke', resourceType: 'tool' },
  ]
) {
  const store = new InMemoryPolicyStore()
  await store.publish({
    policyId: 'workspace-standard',
    version: 1,
    digest: digestA,
    cedar: cedarA,
    createdAt: '2026-08-25T08:00:00.000Z',
  })
  await store.activate('workspace-standard', 1)
  const evaluator = new FakeCedarEvaluator(rules)
  const pdp = new CedarPolicyDecisionPoint({
    store,
    evaluator,
    now: () => '2026-08-25T09:00:00.000Z',
  })
  return { store, evaluator, pdp }
}

describe('PolicyDecisionPoint and Cedar adapter', () => {
  test('authorizes provider-neutral requests and returns auditable policy versions', async () => {
    const { evaluator, pdp } = await fixture()
    const decision = await pdp.authorize(request())
    expect(decision).toMatchObject({
      effect: 'allow',
      reasonCode: 'CEDAR_PERMIT',
      policySnapshot: { policyId: 'workspace-standard', version: 1, digest: digestA },
    })
    expect(evaluator.requests[0]).toMatchObject({
      principal: { entityType: 'Service' },
      action: { entityId: 'tool:invoke' },
      resource: { entityType: 'Tool' },
    })
    expect(JSON.stringify(decision)).not.toContain('permit(principal')
  })

  test('fails closed for missing policy, evaluator failure, conflict, and revocation', async () => {
    const { evaluator, store, pdp } = await fixture([
      { effect: 'permit', action: 'tool:invoke' },
      { effect: 'forbid', action: 'tool:invoke' },
    ])
    await expect(pdp.authorize(request())).resolves.toMatchObject({
      effect: 'deny',
      reasonCode: 'CEDAR_FORBID',
    })
    await store.revoke('workspace-standard', 1)
    await expect(pdp.authorize(request())).resolves.toMatchObject({
      effect: 'deny',
      reasonCode: 'POLICY_REVOKED',
    })
    await expect(
      pdp.authorize(
        request({ policySnapshot: { policyId: 'missing', version: 1, digest: digestA } })
      )
    ).resolves.toMatchObject({ effect: 'deny', reasonCode: 'POLICY_MISSING' })
    evaluator.fail = true
    await store.publish({
      policyId: 'workspace-standard',
      version: 2,
      digest: digestB,
      cedar: cedarB,
      createdAt: '2026-08-25T10:00:00.000Z',
    })
    await expect(
      pdp.authorize(
        request({ policySnapshot: { policyId: 'workspace-standard', version: 2, digest: digestB } })
      )
    ).resolves.toMatchObject({ effect: 'deny', reasonCode: 'POLICY_EVALUATOR_FAILED' })
  })

  test('rejects workspace widening before Cedar evaluation', async () => {
    const { evaluator, pdp } = await fixture()
    const decision = await pdp.authorize(
      request({
        resource: {
          type: 'tool',
          id: 'tlv_01JABCDEF0123456789ABCDEFG',
          workspaceId: otherWorkspace,
          attributes: {},
        },
      })
    )
    expect(decision).toMatchObject({ effect: 'deny', reasonCode: 'WORKSPACE_SCOPE_MISMATCH' })
    expect(evaluator.requests).toHaveLength(0)

    await expect(
      pdp.authorize(
        request({
          resource: {
            type: 'model',
            id: 'model:1',
            workspaceId: workspace,
            attributes: {},
          },
        })
      )
    ).resolves.toMatchObject({ effect: 'deny', reasonCode: 'ACTION_RESOURCE_MISMATCH' })
  })

  test('supports versioned update, test, activation, rollback, and digest-pinned lookup', async () => {
    const { store } = await fixture()
    await store.publish({
      policyId: 'workspace-standard',
      version: 2,
      digest: digestB,
      cedar: cedarB,
      createdAt: '2026-08-25T10:00:00.000Z',
    })
    expect(
      await store.test(
        { policyId: 'workspace-standard', version: 2, digest: digestB },
        new FakeCedarEvaluator([])
      )
    ).toMatchObject({ valid: true })
    await store.activate('workspace-standard', 2)
    expect(await store.active('workspace-standard')).toMatchObject({ version: 2, digest: digestB })
    await store.rollback('workspace-standard', 1)
    expect(await store.active('workspace-standard')).toMatchObject({ version: 1, digest: digestA })
    expect(
      await store.resolve({ policyId: 'workspace-standard', version: 2, digest: digestA })
    ).toBeUndefined()
  })

  test('covers every privileged action class with strict contracts', () => {
    for (const [action, type] of [
      ['runtime:execute', 'runtime'],
      ['tool:invoke', 'tool'],
      ['context:read', 'context'],
      ['context:promote', 'context'],
      ['model:invoke', 'model'],
      ['sandbox:create', 'sandbox'],
      ['sandbox:network', 'sandbox'],
      ['policy:update', 'policy'],
      ['credential:lease', 'credential'],
    ]) {
      expect(
        PolicyAuthorizationRequestSchema.parse(
          request({
            action,
            resource: { type, id: `${type}:1`, workspaceId: workspace, attributes: {} },
          })
        ).action
      ).toBe(action)
    }
  })
})

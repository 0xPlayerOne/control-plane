import { describe, expect, test } from 'bun:test'
import {
  GraphCatalogError,
  GraphCheckpointRecordSchema,
  GraphDefinitionCatalog,
  InMemoryGraphDefinitionRepository,
  checkpointExpiresAt,
} from './graph-catalog.ts'

const publishedAt = '2026-08-25T13:00:00.000Z'
const environment = {
  capabilities: ['runtime.invoke', 'model.invoke', 'tool.invoke'],
  contractMajorVersion: 1,
  compilerVersion: '1.0.0',
  adapterVersion: '1.4.12',
}
const definition = (version, suffix = '') => ({
  graphDefinitionId: 'manager-graph',
  graphVersion: version,
  schemaVersion: 1,
  nodes: [
    { node: 'plan', operation: { kind: 'model', name: `plan${suffix}` } },
    { node: 'execute', operation: { kind: 'runtime', name: 'execute' } },
  ],
  edges: [
    { from: '__start__', to: 'plan' },
    { from: 'plan', to: 'execute' },
    { from: 'execute', to: '__end__' },
  ],
  schemas: {
    input: 'schema://manager/input/v1',
    state: 'schema://manager/state/v1',
    output: 'schema://manager/output/v1',
  },
  requiredCapabilities: environment.capabilities,
  compatibility: {
    contractMajorVersions: [1],
    compilerVersions: ['1.0.0'],
    adapterVersions: ['1.4.12'],
  },
})

describe('versioned graph definitions', () => {
  test('pins immutable published content while later graph versions are added', async () => {
    const catalog = new GraphDefinitionCatalog(new InMemoryGraphDefinitionRepository())
    const first = await catalog.publish({ definition: definition('1.0.0'), publishedAt })
    const pinned = await catalog.resolveForNewExecution(first.reference, environment)
    await catalog.publish({ definition: definition('2.0.0', '-v2'), publishedAt })
    expect((await catalog.getPinned(pinned.reference)).content.nodes[0].operation.name).toBe('plan')
    await expect(
      catalog.publish({ definition: definition('1.0.0', '-mutated'), publishedAt })
    ).rejects.toMatchObject({ code: 'GRAPH_VERSION_CONFLICT' })
  })

  test('blocks deprecated, revoked, and incompatible new executions without rewriting history', async () => {
    const catalog = new GraphDefinitionCatalog(new InMemoryGraphDefinitionRepository())
    const published = await catalog.publish({ definition: definition('1.0.0'), publishedAt })
    await expect(
      catalog.resolveForNewExecution(published.reference, {
        ...environment,
        adapterVersion: '2.0.0',
      })
    ).rejects.toMatchObject({ code: 'GRAPH_INCOMPATIBLE' })
    const deprecated = await catalog.deprecate({
      reference: published.reference,
      expectedRevision: 1,
      changedAt: '2026-08-25T14:00:00.000Z',
      reason: 'replacement published',
    })
    await expect(
      catalog.resolveForNewExecution(published.reference, environment)
    ).rejects.toMatchObject({ code: 'GRAPH_DEPRECATED' })
    const revoked = await catalog.revoke({
      reference: published.reference,
      expectedRevision: deprecated.revision,
      changedAt: '2026-08-25T15:00:00.000Z',
      reason: 'unsafe topology',
    })
    expect((await catalog.getPinned(revoked.reference)).reference).toEqual(published.reference)
    await expect(
      catalog.resolveForNewExecution(published.reference, environment)
    ).rejects.toBeInstanceOf(GraphCatalogError)
  })

  test('keeps checkpoint lineage execution-scoped and separate from ProjectState', () => {
    const checkpoint = GraphCheckpointRecordSchema.parse({
      workspaceId: 'wsp_01JABCDEF0123456789ABCDEFG',
      executionId: 'exe_01JABCDEF0123456789ABCDEFG',
      workflowId: 'wfl_01JABCDEF0123456789ABCDEFG',
      threadId: 'thread-manager-1',
      checkpointId: 'checkpoint-2',
      parentCheckpointId: 'checkpoint-1',
      graph: {
        graphDefinitionId: 'manager-graph',
        graphVersion: '1.0.0',
        contentDigest: `sha256:${'a'.repeat(64)}`,
      },
      compilerVersion: '1.0.0',
      adapterVersion: '1.4.12',
      state: 'active',
      createdAt: publishedAt,
      expiresAt: '2026-09-25T13:00:00.000Z',
    })
    expect(checkpoint).not.toHaveProperty('projectState')
    expect(checkpoint.parentCheckpointId).toBe('checkpoint-1')
    const policy = { activeDays: 90, completedDays: 30, failedDays: 60 }
    expect(checkpointExpiresAt('active', publishedAt, policy)).toBe('2026-11-23T13:00:00.000Z')
    expect(checkpointExpiresAt('completed', publishedAt, policy)).toBe('2026-09-24T13:00:00.000Z')
  })
})

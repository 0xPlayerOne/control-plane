import { describe, expect, test } from 'bun:test'
import {
  ContextCompilationError,
  ContextPackageCompiler,
  ContextPackageSchema,
  InMemoryContextPackageRepository,
  contextPackageSerializationFixtures,
  composeProviderContextPackage,
  deriveContextPackage,
} from './index.ts'

const now = '2026-08-23T12:00:00.000Z'
const workspaceId = 'wsp_01JABCDEF0123456789ABCDEFG'
const projectId = 'prj_01JABCDEF0123456789ABCDEFG'
const itemOneId = 'psi_01JABCDEF0123456789ABCDEFG'
const itemTwoId = 'psi_01JBBCDEF0123456789ABCDEFG'
const artifactId = 'art_01JABCDEF0123456789ABCDEFG'

describe('reproducible ContextPackage compilation', () => {
  test('pins the exact ProjectState revision and selected item revisions', () => {
    const package_ = compile(baseInput())

    expect(package_).toMatchObject({
      projectState: { workspaceId, projectId, revision: 7 },
      stateItems: [
        { itemId: itemOneId, itemRevision: 2 },
        { itemId: itemTwoId, itemRevision: 1 },
      ],
    })
    expect(package_.artifactRefs[0].artifactId).toBe(artifactId)
  })

  test('produces equivalent normalized output for unchanged inputs and compiler version', () => {
    const first = compile(baseInput())
    const second = compile(JSON.parse(JSON.stringify(baseInput())))

    expect(second).toEqual(first)
    expect(second.contentDigest).toBe(first.contentDigest)
    expect(second.contextPackageId).toBe(first.contextPackageId)
  })

  test('enforces size and token budgets with deterministic optional truncation', () => {
    const input = baseInput()
    input.budgets = { maximumBytes: 350, maximumTokens: 45 }
    input.candidates[0].required = true
    input.candidates[0].priority = 10
    input.candidates[1].required = false
    input.candidates[1].priority = 1
    const package_ = compile(input)

    expect(package_.stateItems.map((item) => item.itemId)).toEqual([itemOneId])
    expect(package_.truncation).toEqual({
      truncated: true,
      excluded: [{ ref: `state-item:${itemTwoId}`, reason: 'BUDGET_LIMIT' }],
    })
    expect(package_.usage.bytes).toBeLessThanOrEqual(350)
    expect(package_.usage.tokens).toBeLessThanOrEqual(45)
    expect(() =>
      deriveContextPackage(package_, {
        objective: 'Recover truncated context',
        allowedStateItemIds: [itemTwoId],
        allowedArtifactIds: [],
        budgets: { maximumBytes: 100, maximumTokens: 20 },
        successCriteria: ['Do not expand'],
        returnContract: package_.returnContract,
        compiledAt: now,
      })
    ).toThrow('CHILD_SCOPE_EXPANSION')
  })

  test('rejects unauthorized and revoked context', () => {
    const unauthorized = baseInput()
    unauthorized.candidates[0].authorized = false
    expectCompileError(unauthorized, 'UNAUTHORIZED_CONTEXT')

    const revoked = baseInput()
    revoked.artifacts[0].state = 'revoked'
    expectCompileError(revoked, 'REVOKED_ARTIFACT')

    const contradictory = baseInput()
    contradictory.artifacts.push({ ...contradictory.artifacts[0], state: 'missing' })
    expectCompileError(contradictory, 'CONTRADICTORY_CONTEXT_REFERENCE')
  })

  test('classifies stale state, stale required items, and missing artifacts', () => {
    const staleState = baseInput()
    staleState.expectedProjectStateRevision = 6
    expectCompileError(staleState, 'STALE_PROJECT_STATE')

    const expired = baseInput()
    expired.projectState.items[0].freshness.expiresAt = '2026-08-23T11:00:00.000Z'
    expectCompileError(expired, 'STALE_REQUIRED_CONTEXT')

    const missing = baseInput()
    missing.artifacts = []
    expectCompileError(missing, 'MISSING_ARTIFACT')
  })

  test('allows child derivation to narrow but never expand parent authority', () => {
    const parent = compile(baseInput())
    const child = deriveContextPackage(parent, {
      objective: 'Handle the focused child task',
      allowedStateItemIds: [itemOneId],
      allowedArtifactIds: [artifactId],
      budgets: { maximumBytes: 300, maximumTokens: 40 },
      successCriteria: ['Return focused evidence'],
      returnContract: { contractRef: 'contract://child-result/v1' },
      compiledAt: now,
    })

    expect(child.parentContextPackage).toEqual({
      contextPackageId: parent.contextPackageId,
      contentDigest: parent.contentDigest,
    })
    expect(child.stateItems.map((item) => item.itemId)).toEqual([itemOneId])
    expect(() =>
      deriveContextPackage(parent, {
        objective: 'Expand',
        allowedStateItemIds: ['psi_01JZBCDEF0123456789ABCDEFG'],
        allowedArtifactIds: [artifactId],
        budgets: parent.budgets,
        successCriteria: ['Expand'],
        returnContract: parent.returnContract,
        compiledAt: now,
      })
    ).toThrow('CHILD_SCOPE_EXPANSION')
  })

  test('persists immutable references and publishes adapter-neutral serialization fixtures', async () => {
    const package_ = compile(baseInput())
    const repository = new InMemoryContextPackageRepository()
    const reference = await repository.put(package_)

    expect(await repository.get(reference)).toEqual(package_)
    expect(await repository.getById(package_.contextPackageId)).toEqual(package_)
    expect(await repository.getById('ctx_01JABCDEF0123456789ABCDEFG')).toBeUndefined()
    expect(await repository.put(package_)).toEqual(reference)
    await expect(repository.put({ ...package_, objective: 'tampered' })).rejects.toThrow(
      'CONTEXT_PACKAGE_INTEGRITY_ERROR'
    )
    expect(Object.keys(contextPackageSerializationFixtures).sort()).toEqual([
      'futureAcp',
      'futureLangGraph',
      'futurePi',
    ])
    for (const fixture of Object.values(contextPackageSerializationFixtures)) {
      expect(ContextPackageSchema.parse(fixture)).toBeDefined()
      expect(JSON.stringify(fixture)).not.toMatch(/credential|nativeSession|localPath/)
    }
  })

  test('composes provider contributions without mutating ProjectState authority', () => {
    const package_ = compile(baseInput())
    const composed = composeProviderContextPackage(package_, {
      callerContextRefs: ['caller://request/1'],
      localProjectGrantRefs: ['grant://local/1'],
      contributions: [
        {
          providerId: 'ctp_01JABCDEF0123456789ABCDEFG',
          connectionId: 'ctc_01JABCDEF0123456789ABCDEFG',
          contractVersion: '1.0.0',
          contributionId: 'evidence-1',
          kind: 'evidence',
          content: 'bounded provider evidence',
          tokenCount: 4,
          observedAt: now,
          scopeDigest: `sha256:${'a'.repeat(64)}`,
          revision: 'corpus-1',
          contentDigest: `sha256:${'b'.repeat(64)}`,
          degraded: false,
          provenance: [
            {
              sourceRef: 'https://example.invalid/evidence/1',
              citation: 'Evidence 1',
              sourceKind: 'external_evidence',
            },
          ],
        },
      ],
    })
    expect(composed.projectState).toEqual(package_.projectState)
    expect(composed.stateItems).toEqual(package_.stateItems)
    expect(composed.providerComposition).toMatchObject({
      callerContextRefs: ['caller://request/1'],
      localProjectGrantRefs: ['grant://local/1'],
    })
    expect(composed.contentDigest).not.toBe(package_.contentDigest)
  })
})

function compile(input) {
  return new ContextPackageCompiler('1.0.0').compile(input)
}

function expectCompileError(input, code) {
  try {
    compile(input)
    throw new Error('Expected compilation to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(ContextCompilationError)
    expect(error.code).toBe(code)
  }
}

function baseInput() {
  const provenance = {
    sourceKind: 'principal',
    sourcePrincipalRef: 'principal://agent-hq/user/42',
    artifactRefs: [],
    capturedAt: '2026-08-22T12:00:00.000Z',
  }
  return {
    objective: 'Complete the milestone with evidence',
    projectState: {
      schemaVersion: 1,
      workspaceId,
      projectId,
      revision: 7,
      createdAt: '2026-08-20T12:00:00.000Z',
      updatedAt: '2026-08-22T12:00:00.000Z',
      items: [
        {
          itemId: itemOneId,
          itemRevision: 2,
          key: 'goal',
          value: 'Complete M2 safely',
          sensitivity: 'internal',
          freshness: { observedAt: '2026-08-22T12:00:00.000Z' },
          provenance: { ...provenance, artifactRefs: [artifactId] },
          createdAt: '2026-08-21T12:00:00.000Z',
          updatedAt: '2026-08-22T12:00:00.000Z',
        },
        {
          itemId: itemTwoId,
          itemRevision: 1,
          key: 'owner',
          value: 'platform',
          sensitivity: 'internal',
          freshness: { observedAt: '2026-08-22T12:00:00.000Z' },
          provenance,
          createdAt: '2026-08-22T12:00:00.000Z',
          updatedAt: '2026-08-22T12:00:00.000Z',
        },
      ],
    },
    expectedProjectStateRevision: 7,
    candidates: [
      { itemId: itemOneId, itemRevision: 2, required: true, priority: 10, authorized: true },
      { itemId: itemTwoId, itemRevision: 1, required: true, priority: 5, authorized: true },
    ],
    artifacts: [
      {
        artifactId,
        contentDigest: `sha256:${'b'.repeat(64)}`,
        mediaType: 'text/plain',
        sizeBytes: 64,
        sensitivity: 'internal',
        state: 'available',
        authorized: true,
      },
    ],
    constraints: {
      allowedSensitivities: ['public', 'internal'],
      allowedStateItemIds: [itemOneId, itemTwoId],
      allowedArtifactIds: [artifactId],
    },
    permissions: ['project-state:read', 'artifact:read'],
    successCriteria: ['All selected context is pinned', 'Return evidence'],
    returnContract: { contractRef: 'contract://execution-result/v1' },
    budgets: { maximumBytes: 4_096, maximumTokens: 1_024 },
    compiledAt: now,
  }
}

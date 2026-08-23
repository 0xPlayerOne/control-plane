import { describe, expect, test } from 'bun:test'
import {
  CatalogError,
  InMemoryVersionedCatalogRepository,
  VersionedCatalog,
  executionConstraintFixtures,
} from './index.ts'

const now = '2026-08-23T12:00:00.000Z'
const later = '2026-08-23T13:00:00.000Z'
const profileId = 'prf_01JABCDEF0123456789ABCDEFG'
const profileVersionId = 'pfv_01JABCDEF0123456789ABCDEFG'
const secondProfileVersionId = 'pfv_01JBBCDEF0123456789ABCDEFG'
const skillId = 'skl_01JABCDEF0123456789ABCDEFG'
const skillVersionId = 'skv_01JABCDEF0123456789ABCDEFG'
const secondSkillVersionId = 'skv_01JBBCDEF0123456789ABCDEFG'

describe('immutable AgentProfile and Skill versions', () => {
  test('publishes content-addressed versions that cannot be mutated in place', async () => {
    const { catalog, profileDraft, skillDraft } = await seededCatalog()
    const skill = await catalog.publishSkillVersion({
      skillVersionId,
      expectedRevision: skillDraft.revision,
      publishedAt: later,
    })
    const profile = await catalog.publishAgentProfileVersion({
      profileVersionId,
      expectedRevision: profileDraft.revision,
      publishedAt: later,
    })

    expect(skill.lifecycle).toBe('published')
    expect(profile.lifecycle).toBe('published')
    expect(skill.manifest.contentDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(profile.contentDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    await expect(
      catalog.updateAgentProfileDraft({
        profileVersionId,
        expectedRevision: profile.revision,
        definition: { ...profile.definition, roleInstructions: 'mutated' },
      })
    ).rejects.toMatchObject({ code: 'VERSION_NOT_DRAFT' })

    profile.definition.roleInstructions = 'external mutation'
    const resolved = await catalog.resolveAgentProfile({ profileId, profileVersionId })
    expect(resolved.state).toBe('available')
    expect(resolved.version.definition.roleInstructions).toBe('Coordinate execution safely')
  })

  test('keeps pins stable when newer versions publish and supports explicit supersession', async () => {
    const { catalog, profileDraft, skillDraft } = await seededCatalog()
    await catalog.publishSkillVersion({
      skillVersionId,
      expectedRevision: skillDraft.revision,
      publishedAt: later,
    })
    const first = await catalog.publishAgentProfileVersion({
      profileVersionId,
      expectedRevision: profileDraft.revision,
      publishedAt: later,
    })
    const secondDraft = await catalog.createAgentProfileDraft({
      profileId,
      profileVersionId: secondProfileVersionId,
      version: 2,
      definition: profileDefinition(profileDraft.definition.skills),
      createdAt: later,
    })
    await catalog.publishAgentProfileVersion({
      profileVersionId: secondProfileVersionId,
      expectedRevision: secondDraft.revision,
      publishedAt: later,
    })

    expect(
      (await catalog.resolveAgentProfile({ profileId, profileVersionId })).version.version
    ).toBe(1)
    const superseded = await catalog.supersedeAgentProfileVersion(
      profileVersionId,
      first.revision,
      later,
      secondProfileVersionId
    )
    expect(superseded.lifecycle).toBe('superseded')
    expect(superseded.definition).toEqual(first.definition)
  })

  test('returns explicit missing, deprecated, revoked, and incompatible states', async () => {
    const { catalog, profileDraft, skillDraft } = await seededCatalog()
    await catalog.publishSkillVersion({
      skillVersionId,
      expectedRevision: skillDraft.revision,
      publishedAt: later,
    })
    const published = await catalog.publishAgentProfileVersion({
      profileVersionId,
      expectedRevision: profileDraft.revision,
      publishedAt: later,
    })
    const incompatible = await catalog.resolveAgentProfile(
      { profileId, profileVersionId },
      { capabilities: [], tools: [], contractMajorVersion: 1 }
    )
    const deprecated = await catalog.deprecateAgentProfileVersion(
      profileVersionId,
      published.revision,
      later,
      'Use version 2'
    )

    expect(incompatible.state).toBe('incompatible')
    expect(incompatible.reasons).toEqual([
      'MISSING_CAPABILITY:filesystem.read',
      'MISSING_TOOL:project-files',
    ])
    expect((await catalog.resolveAgentProfile({ profileId, profileVersionId })).state).toBe(
      'deprecated'
    )
    const revoked = await catalog.revokeAgentProfileVersion(
      profileVersionId,
      deprecated.revision,
      later,
      'Security issue'
    )
    expect(revoked.lifecycle).toBe('revoked')
    expect((await catalog.resolveAgentProfile({ profileId, profileVersionId })).state).toBe(
      'revoked'
    )
    expect(
      (
        await catalog.resolveAgentProfile({
          profileId,
          profileVersionId: 'pfv_01JZBCDEF0123456789ABCDEFG',
        })
      ).state
    ).toBe('missing')
  })

  test('resolves exact Skill versions and rejects digest drift', async () => {
    const { catalog, skillDraft } = await seededCatalog()
    const published = await catalog.publishSkillVersion({
      skillVersionId,
      expectedRevision: skillDraft.revision,
      publishedAt: later,
    })

    expect(
      (
        await catalog.resolveSkill({
          skillId,
          skillVersionId,
          contentDigest: published.manifest.contentDigest,
        })
      ).state
    ).toBe('available')
    expect(
      (
        await catalog.resolveSkill({
          skillId,
          skillVersionId,
          contentDigest: `sha256:${'f'.repeat(64)}`,
        })
      ).state
    ).toBe('incompatible')
  })

  test('allows only one concurrent publish winner', async () => {
    const { catalog, profileDraft } = await seededCatalog()
    const competingDraft = await catalog.createAgentProfileDraft({
      profileId,
      profileVersionId: secondProfileVersionId,
      version: 1,
      definition: profileDraft.definition,
      createdAt: now,
    })
    const attempts = await Promise.allSettled([
      catalog.publishAgentProfileVersion({
        profileVersionId: secondProfileVersionId,
        expectedRevision: competingDraft.revision,
        publishedAt: later,
      }),
      catalog.publishAgentProfileVersion({
        profileVersionId,
        expectedRevision: profileDraft.revision,
        publishedAt: later,
      }),
    ])

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1)
    const rejection = attempts.find((attempt) => attempt.status === 'rejected')
    expect(rejection.reason).toBeInstanceOf(CatalogError)
    expect(rejection.reason.code).toBe('VERSION_REVISION_CONFLICT')
  })

  test('rejects duplicate published profile and skill versions', async () => {
    const { catalog, profileDraft, skillDraft } = await seededCatalog()
    await catalog.publishSkillVersion({
      skillVersionId,
      expectedRevision: skillDraft.revision,
      publishedAt: later,
    })
    await catalog.publishAgentProfileVersion({
      profileVersionId,
      expectedRevision: profileDraft.revision,
      publishedAt: later,
    })
    const duplicateSkill = await catalog.createSkillDraft({
      skillId,
      skillVersionId: secondSkillVersionId,
      manifest: skillManifest(),
      content: skillContent(),
      createdAt: later,
    })
    const duplicateProfile = await catalog.createAgentProfileDraft({
      profileId,
      profileVersionId: secondProfileVersionId,
      version: 1,
      definition: profileDefinition([exactSkillReference(skillDraft)]),
      createdAt: later,
    })

    await expect(
      catalog.publishSkillVersion({
        skillVersionId: secondSkillVersionId,
        expectedRevision: duplicateSkill.revision,
        publishedAt: later,
      })
    ).rejects.toMatchObject({ code: 'SKILL_SEMANTIC_VERSION_CONFLICT' })
    await expect(
      catalog.publishAgentProfileVersion({
        profileVersionId: secondProfileVersionId,
        expectedRevision: duplicateProfile.revision,
        publishedAt: later,
      })
    ).rejects.toMatchObject({ code: 'VERSION_NUMBER_CONFLICT' })
  })
})

async function seededCatalog() {
  const repository = new InMemoryVersionedCatalogRepository()
  const catalog = new VersionedCatalog(repository, repository)
  await catalog.createAgentProfile({
    profileId,
    displayName: 'Execution Coordinator',
    ownership: { scope: 'workspace', workspaceId: 'wsp_01JABCDEF0123456789ABCDEFG' },
    createdAt: now,
  })
  await catalog.createSkill({
    skillId,
    displayName: 'Read project files',
    ownership: { scope: 'system' },
    createdAt: now,
  })
  const skillDraft = await catalog.createSkillDraft({
    skillId,
    skillVersionId,
    manifest: skillManifest(),
    content: skillContent(),
    createdAt: now,
  })
  const profileDraft = await catalog.createAgentProfileDraft({
    profileId,
    profileVersionId,
    version: 1,
    definition: profileDefinition([exactSkillReference(skillDraft)]),
    createdAt: now,
  })
  return { catalog, profileDraft, skillDraft }
}

function skillManifest() {
  return {
    schemaVersion: 1,
    semanticVersion: '1.0.0',
    requiredCapabilities: ['filesystem.read'],
    requiredTools: [{ toolId: 'files', versionRange: '^1.0.0' }],
    compatibleProfileSchemaVersions: [1],
    compatibleContractMajorVersions: [1],
    evalRefs: ['artifact://skill-eval/read-files/v1'],
  }
}

function skillContent() {
  return { instructions: 'Read only the requested project files.', artifactRefs: [] }
}

function exactSkillReference(skillVersion) {
  return {
    skillId: skillVersion.skillId,
    skillVersionId: skillVersion.skillVersionId,
    contentDigest: skillVersion.manifest.contentDigest,
  }
}

function profileDefinition(skills) {
  return {
    schemaVersion: 1,
    roleInstructions: 'Coordinate execution safely',
    personaInstructions: 'Be concise and evidence-led',
    skills,
    capabilityRequirements: ['filesystem.read'],
    executionConstraints: executionConstraintFixtures.readOnly,
    outputContractRefs: ['contract://execution-summary/v1'],
  }
}

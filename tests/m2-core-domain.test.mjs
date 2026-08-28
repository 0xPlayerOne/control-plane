import { describe, expect, test } from 'bun:test'
import { ContextCompilationError } from '@control-plane/context'
import { ControlApiFixtures, ExecutionPlanPublicReferenceSchema } from '@control-plane/contracts'
import { executionConstraintFixtures } from '@control-plane/domain'
import { ExecutionPlanError } from '@control-plane/execution-plan'
import { ControlPlaneClientError } from '@control-plane/sdk'
import {
  coreAcceptanceIds,
  createCoreDomainAcceptanceHarness,
} from './support/core-domain-acceptance.mjs'

describe('M2 core-domain acceptance', () => {
  test('compiles and retrieves an immutable plan from an authenticated Agent HQ intent', async () => {
    const harness = await createCoreDomainAcceptanceHarness()
    const result = await harness.submitIntent()
    const equivalentContext = harness.compileContext()
    const equivalentPlan = harness.compilePlan(equivalentContext)

    expect(result.principal).toMatchObject({
      kind: 'agent_hq_service',
      principalId: 'svc_agent-hq',
      workspaceIds: [coreAcceptanceIds.workspaceId],
      projectIds: [coreAcceptanceIds.projectId],
    })
    expect(result.profile.lifecycle).toBe('published')
    expect(result.skill.lifecycle).toBe('published')
    expect(result.executionPlan).toMatchObject({
      compiler: { name: 'control-plane-execution-plan', version: '1.0.0' },
      profile: {
        profileVersionId: result.profile.profileVersionId,
        revision: result.profile.revision,
        contentDigest: result.profile.contentDigest,
      },
      skills: [
        {
          skillVersionId: result.skill.skillVersionId,
          revision: result.skill.revision,
          contentDigest: result.skill.manifest.contentDigest,
        },
      ],
      contextPackage: {
        contextPackageId: result.contextPackage.contextPackageId,
        contentDigest: result.contextPackage.contentDigest,
        compilerVersion: '1.0.0',
      },
      correlation: {
        workspaceId: coreAcceptanceIds.workspaceId,
        projectId: coreAcceptanceIds.projectId,
      },
      policySnapshot: executionConstraintFixtures.readOnly.policySnapshot,
    })
    expect(result.executionPlan.runtimeRequirements).toEqual([
      { capability: 'filesystem.read', necessity: 'required', minimumSupport: 'supported' },
      { capability: 'stream.output', necessity: 'required', minimumSupport: 'supported' },
    ])
    expect(result.executionPlan.constraints).toMatchObject({
      tools: { default: 'deny' },
      runtime: { allowedFamilies: ['mock'] },
      models: [{ alias: 'reasoning.standard' }],
      policySnapshot: executionConstraintFixtures.readOnly.policySnapshot,
    })
    expect(equivalentContext).toEqual(result.contextPackage)
    expect(equivalentPlan).toEqual(result.executionPlan)
    expect(await harness.contextRepository.get(result.contextReference)).toEqual(
      result.contextPackage
    )
    expect(await harness.planRepository.get(result.executionPlanReference)).toEqual(
      result.executionPlan
    )
    expect(result.profileResponse.data).toMatchObject({
      profile: {
        profileVersionId: result.profile.profileVersionId,
        contentDigest: result.profile.contentDigest,
      },
      skillVersionIds: [result.skill.skillVersionId],
    })
    expect(result.projectStateResponse.data.projectState).toEqual({
      workspaceId: result.projectState.workspaceId,
      projectId: result.projectState.projectId,
      revision: result.projectState.revision,
    })
    expect(result.contextPackageResponse.data.contextPackage).toEqual({
      contextPackageId: result.contextPackage.contextPackageId,
      contentDigest: result.contextPackage.contentDigest,
      schemaVersion: result.contextPackage.schemaVersion,
      compilerVersion: result.contextPackage.compiler.version,
    })
    expect(ExecutionPlanPublicReferenceSchema.parse(result.response.data.executionPlan)).toEqual(
      result.executionPlanReference
    )
    expect(JSON.stringify(result)).not.toMatch(
      /postgres|database|temporal|e2b|langgraph|litellm|mcp|\bpi\b|\bacp\b/i
    )
    expect(harness.dispatches).toBe(0)
  })

  test('rejects invalid, expired, revoked, and cross-scope service credentials', async () => {
    const harness = await createCoreDomainAcceptanceHarness()
    await expectAuthenticationCode(
      () =>
        harness.dispatchAfter(() =>
          harness.authenticate({
            claims: harness.serviceClaims({ credentialKind: 'browser_session' }),
          })
        ),
      'SERVICE_CREDENTIAL_CLASS_REJECTED'
    )
    await expectAuthenticationCode(
      () =>
        harness.dispatchAfter(() =>
          harness.authenticate({
            claims: harness.serviceClaims({ expiresAt: '2026-08-23T13:59:59.000Z' }),
          })
        ),
      'SERVICE_CREDENTIAL_EXPIRED'
    )
    await expectAuthenticationCode(
      () => harness.dispatchAfter(() => harness.authenticate({ revoked: true })),
      'SERVICE_CREDENTIAL_REVOKED'
    )
    const mismatched = globalThis.structuredClone(ControlApiFixtures.authentication.request)
    mismatched.projectId = 'prj_01JZBCDEF0123456789ABCDEFG'
    await expectAuthenticationCode(
      () => harness.dispatchAfter(() => harness.authenticate({ body: mismatched })),
      'SERVICE_CREDENTIAL_SCOPE_MISMATCH'
    )
    const crossWorkspace = globalThis.structuredClone(ControlApiFixtures.authentication.request)
    crossWorkspace.workspaceId = 'wsp_01JZBCDEF0123456789ABCDEFG'
    await expectAuthenticationCode(
      () => harness.dispatchAfter(() => harness.authenticate({ body: crossWorkspace })),
      'SERVICE_CREDENTIAL_SCOPE_MISMATCH'
    )
    await expectAuthenticationCode(
      () =>
        harness.dispatchAfter(() =>
          harness.authenticate({
            requiredScopes: ['profile:resolve'],
          })
        ),
      'SERVICE_REQUEST_ENVELOPE_INVALID'
    )
    expect(harness.dispatches).toBe(0)
  })

  test('classifies catalog lifecycle and compatibility failures without mutating pins', async () => {
    const harness = await createCoreDomainAcceptanceHarness()
    expect(
      (
        await harness.catalog.resolveAgentProfile({
          profileId: harness.profile.profileId,
          profileVersionId: 'pfv_01JZBCDEF0123456789ABCDEFG',
        })
      ).state
    ).toBe('missing')
    expect(
      (
        await harness.catalog.resolveSkill({
          skillId: harness.skill.skillId,
          skillVersionId: 'skv_01JZBCDEF0123456789ABCDEFG',
          contentDigest: harness.skill.manifest.contentDigest,
        })
      ).state
    ).toBe('missing')
    expect(
      (
        await harness.catalog.resolveAgentProfile(
          {
            profileId: harness.profile.profileId,
            profileVersionId: harness.profile.profileVersionId,
          },
          { capabilities: [], tools: [], contractMajorVersion: 2 }
        )
      ).state
    ).toBe('incompatible')

    harness.profile.definition.roleInstructions = 'tampered outside the catalog'
    harness.skill.content.instructions = 'tampered outside the catalog'
    const resolvedProfile = await harness.catalog.resolveAgentProfile({
      profileId: harness.profile.profileId,
      profileVersionId: harness.profile.profileVersionId,
    })
    const resolvedSkill = await harness.catalog.resolveSkill({
      skillId: harness.skill.skillId,
      skillVersionId: harness.skill.skillVersionId,
      contentDigest: harness.skill.manifest.contentDigest,
    })
    expect(resolvedProfile.version.definition.roleInstructions).not.toContain('tampered')
    expect(resolvedSkill.version.content.instructions).not.toContain('tampered')
    await expect(
      harness.dispatchAfter(() =>
        harness.catalog.updateAgentProfileDraft({
          profileVersionId: harness.profile.profileVersionId,
          expectedRevision: harness.profile.revision,
          definition: harness.profile.definition,
        })
      )
    ).rejects.toMatchObject({ code: 'VERSION_NOT_DRAFT' })

    const deprecatedProfile = await harness.catalog.deprecateAgentProfileVersion(
      harness.profile.profileVersionId,
      harness.profile.revision,
      '2026-08-23T16:00:00.000Z',
      'acceptance lifecycle check'
    )
    expect(
      (
        await harness.catalog.resolveAgentProfile({
          profileId: harness.profile.profileId,
          profileVersionId: harness.profile.profileVersionId,
        })
      ).state
    ).toBe('deprecated')
    await harness.catalog.revokeAgentProfileVersion(
      harness.profile.profileVersionId,
      deprecatedProfile.revision,
      '2026-08-23T17:00:00.000Z',
      'acceptance lifecycle check'
    )
    expect(
      (
        await harness.catalog.resolveAgentProfile({
          profileId: harness.profile.profileId,
          profileVersionId: harness.profile.profileVersionId,
        })
      ).state
    ).toBe('revoked')

    const deprecatedSkill = await harness.catalog.deprecateSkillVersion(
      harness.skill.skillVersionId,
      harness.skill.revision,
      '2026-08-23T16:00:00.000Z',
      'acceptance lifecycle check'
    )
    expect(
      (
        await harness.catalog.resolveSkill({
          skillId: harness.skill.skillId,
          skillVersionId: harness.skill.skillVersionId,
          contentDigest: harness.skill.manifest.contentDigest,
        })
      ).state
    ).toBe('deprecated')
    await harness.catalog.revokeSkillVersion(
      harness.skill.skillVersionId,
      deprecatedSkill.revision,
      '2026-08-23T17:00:00.000Z',
      'acceptance lifecycle check'
    )
    expect(
      (
        await harness.catalog.resolveSkill({
          skillId: harness.skill.skillId,
          skillVersionId: harness.skill.skillVersionId,
          contentDigest: harness.skill.manifest.contentDigest,
        })
      ).state
    ).toBe('revoked')
    expect(harness.dispatches).toBe(0)
  })

  test('fails stale, unauthorized, and over-budget context before plan compilation', async () => {
    const harness = await createCoreDomainAcceptanceHarness()
    await expectCoreError(
      () =>
        harness.dispatchAfter(() =>
          harness.compileContext((input) => {
            input.expectedProjectStateRevision -= 1
          })
        ),
      ContextCompilationError,
      'STALE_PROJECT_STATE'
    )
    await expectCoreError(
      () =>
        harness.dispatchAfter(() =>
          harness.compileContext((input) => {
            input.candidates[0].authorized = false
          })
        ),
      ContextCompilationError,
      'UNAUTHORIZED_CONTEXT'
    )
    await expectCoreError(
      () =>
        harness.dispatchAfter(() =>
          harness.compileContext((input) => {
            input.budgets = { maximumBytes: 1, maximumTokens: 1 }
          })
        ),
      ContextCompilationError,
      'REQUIRED_CONTEXT_EXCEEDS_BUDGET'
    )
    expect(harness.dispatches).toBe(0)
  })

  test('classifies missing, revoked, deprecated, incompatible, and contradictory plan inputs', async () => {
    const harness = await createCoreDomainAcceptanceHarness()
    const contextPackage = harness.compileContext()
    const cases = [
      [
        'MISSING_PROFILE_VERSION',
        (input) => {
          input.profile = undefined
        },
      ],
      [
        'MISSING_SKILL_VERSION',
        (input) => {
          input.skills = []
        },
      ],
      [
        'REVOKED_REFERENCE',
        (input) => {
          input.skills[0].lifecycle = 'revoked'
        },
      ],
      [
        'DEPRECATED_REFERENCE',
        (input) => {
          input.profile.lifecycle = 'deprecated'
        },
      ],
      [
        'INCOMPATIBLE_REFERENCE',
        (input) => {
          input.skills[0].manifest.compatibleContractMajorVersions = [2]
        },
      ],
      [
        'INCOMPATIBLE_REFERENCE',
        (input) => {
          input.constraints.tools.grants = []
        },
      ],
    ]
    for (const [code, mutate] of cases) {
      await expectCoreError(
        () => harness.dispatchAfter(() => harness.compilePlan(contextPackage, mutate)),
        ExecutionPlanError,
        code
      )
    }

    await expectCoreError(
      () =>
        harness.dispatchAfter(() =>
          harness.compilePlan(contextPackage, (input) => {
            const toolConflict = globalThis.structuredClone(executionConstraintFixtures.readOnly)
            toolConflict.tools.grants[0].operations = ['write']
            input.requestConstraints = [toolConflict]
          })
        ),
      ExecutionPlanError,
      'INCOMPATIBLE_REFERENCE'
    )

    for (const mutateConstraint of [
      (constraint) => {
        constraint.runtime.allowedFamilies = ['other']
      },
      (constraint) => {
        constraint.models[0].providerPolicy.allowedClasses = ['private_cloud']
      },
      (constraint) => {
        constraint.policySnapshot.digest = `sha256:${'f'.repeat(64)}`
      },
    ]) {
      await expectCoreError(
        () =>
          harness.dispatchAfter(() =>
            harness.compilePlan(contextPackage, (input) => {
              const contradictory = globalThis.structuredClone(executionConstraintFixtures.readOnly)
              mutateConstraint(contradictory)
              input.requestConstraints = [contradictory]
            })
          ),
        ExecutionPlanError,
        'CONTRADICTORY_REQUIREMENTS'
      )
    }
    expect(harness.dispatches).toBe(0)
  })

  test('rejects persisted mutation, SDK drift, and cross-scope retrieval', async () => {
    const harness = await createCoreDomainAcceptanceHarness()
    const result = await harness.submitIntent()
    const loaded = await harness.planRepository.get(result.executionPlanReference)
    loaded.outputContract.contractRef = 'contract://tampered/v1'
    expect(
      (await harness.planRepository.get(result.executionPlanReference)).outputContract
    ).toEqual(result.executionPlan.outputContract)
    await expect(
      harness.dispatchAfter(() =>
        harness.planRepository.put({
          ...result.executionPlan,
          compiledAt: '2026-08-23T16:00:00.000Z',
        })
      )
    ).rejects.toThrow('EXECUTION_PLAN_INTEGRITY_ERROR')

    const driftHarness = await createCoreDomainAcceptanceHarness()
    await expectCoreError(
      () =>
        driftHarness.dispatchAfter(() =>
          driftHarness.submitIntent({ responseContractVersion: { major: 1, minor: 0 } })
        ),
      ControlPlaneClientError,
      'INCOMPATIBLE_CONTRACT_VERSION'
    )
    expect(harness.dispatches).toBe(0)
    expect(driftHarness.dispatches).toBe(0)

    const isolatedHarness = await createCoreDomainAcceptanceHarness()
    await expect(
      isolatedHarness.dispatchAfter(() =>
        isolatedHarness.submitIntent({
          mutatePublicRequest(path, request) {
            if (path === '/v1/context-packages/resolve') {
              request.parameters.contextPackageId = 'ctx_01JZBCDEF0123456789ABCDEFG'
            }
          },
        })
      )
    ).rejects.toThrow('CONTEXT_PACKAGE_MISSING')
    expect(isolatedHarness.dispatches).toBe(0)

    const profileIsolationHarness = await createCoreDomainAcceptanceHarness()
    await expect(
      profileIsolationHarness.dispatchAfter(() =>
        profileIsolationHarness.submitIntent({
          mutatePublicRequest(path, request) {
            if (path === '/v1/profiles/resolve') {
              request.parameters.profileId = coreAcceptanceIds.foreignProfileId
              delete request.parameters.profileVersionId
            }
          },
        })
      )
    ).rejects.toThrow('PROFILE_SCOPE_MISMATCH')
    expect(profileIsolationHarness.dispatches).toBe(0)
  }, 20_000)
})

async function expectAuthenticationCode(action, code) {
  try {
    await action()
    throw new Error(`Expected authentication to fail with ${code}`)
  } catch (error) {
    const response = error.getResponse?.()
    expect(response?.code).toBe(code)
  }
}

async function expectCoreError(action, errorType, code) {
  try {
    await action()
    throw new Error(`Expected core operation to fail with ${code}`)
  } catch (error) {
    expect(error).toBeInstanceOf(errorType)
    expect(error.code).toBe(code)
  }
}

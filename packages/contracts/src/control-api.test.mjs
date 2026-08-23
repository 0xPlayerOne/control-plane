import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import {
  ContextPackagePublicReferenceSchema,
  ControlApiFixtures,
  ExecutionRequestValidationRequestSchema,
  ExecutionRequestValidationResponseSchema,
  ProfileResolutionRequestSchema,
  ProfileResolutionResponseSchema,
  ProjectStateReferenceSchema,
  RuntimeListRequestSchema,
  RuntimeListResponseSchema,
  ServiceAuthenticationRequestSchema,
  ServiceAuthenticationResponseSchema,
} from './index.ts'

describe('Agent HQ Control API contracts', () => {
  test('prepares the independently installable contract package for release automation', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

    expect(manifest.name).toBe('@control-plane/contracts')
    expect(manifest.version).toBe('0.0.0')
    expect(manifest.license).toBe('Apache-2.0')
    expect(manifest.private).toBeUndefined()
    expect(manifest.publishConfig).toEqual({ access: 'public', provenance: true })
  })

  test('publishes deterministic authentication and profile-resolution fixtures', () => {
    expect(
      ServiceAuthenticationRequestSchema.parse(ControlApiFixtures.authentication.request)
    ).toEqual(ControlApiFixtures.authentication.request)
    expect(
      ServiceAuthenticationResponseSchema.parse(ControlApiFixtures.authentication.response)
    ).toEqual(ControlApiFixtures.authentication.response)
    expect(
      ProfileResolutionRequestSchema.parse(ControlApiFixtures.profileResolution.request)
    ).toEqual(ControlApiFixtures.profileResolution.request)
    expect(
      ProfileResolutionResponseSchema.parse(ControlApiFixtures.profileResolution.response)
    ).toEqual(ControlApiFixtures.profileResolution.response)
  })

  test('exposes only immutable ProjectState and ContextPackage references', () => {
    expect(ProjectStateReferenceSchema.parse(ControlApiFixtures.projectStateReference)).toEqual(
      ControlApiFixtures.projectStateReference
    )
    expect(
      ContextPackagePublicReferenceSchema.parse(ControlApiFixtures.contextPackageReference)
    ).toEqual(ControlApiFixtures.contextPackageReference)

    expect(
      ProjectStateReferenceSchema.parse({
        ...ControlApiFixtures.projectStateReference,
        items: [{ key: 'secret', value: 'server-only' }],
      })
    ).toEqual(ControlApiFixtures.projectStateReference)
    expect(
      ContextPackagePublicReferenceSchema.parse({
        ...ControlApiFixtures.contextPackageReference,
        rawContext: 'server-only',
      })
    ).toEqual(ControlApiFixtures.contextPackageReference)
  })

  test('models runtime discovery without native handles or credentials', () => {
    expect(RuntimeListRequestSchema.parse(ControlApiFixtures.runtimeList.request)).toEqual(
      ControlApiFixtures.runtimeList.request
    )
    expect(RuntimeListResponseSchema.parse(ControlApiFixtures.runtimeList.response)).toEqual(
      ControlApiFixtures.runtimeList.response
    )

    const serialized = JSON.stringify(ControlApiFixtures.runtimeList.response).toLowerCase()
    for (const prohibited of [
      'credential',
      'processhandle',
      'temporal',
      'langgraph',
      'pi_',
      'acp',
    ]) {
      expect(serialized).not.toContain(prohibited)
    }
  })

  test('validates execution requests against exact #17 plan inputs and returns an immutable plan ref', () => {
    expect(
      ExecutionRequestValidationRequestSchema.parse(ControlApiFixtures.executionValidation.request)
    ).toEqual(ControlApiFixtures.executionValidation.request)
    expect(
      ExecutionRequestValidationResponseSchema.parse(
        ControlApiFixtures.executionValidation.response
      )
    ).toEqual(ControlApiFixtures.executionValidation.response)

    expect(
      ExecutionRequestValidationRequestSchema.safeParse({
        ...ControlApiFixtures.executionValidation.request,
        payload: {
          ...ControlApiFixtures.executionValidation.request.payload,
          profileVersionId: undefined,
        },
      }).success
    ).toBe(false)
    expect(
      ExecutionRequestValidationResponseSchema.parse({
        ...ControlApiFixtures.executionValidation.response,
        data: {
          ...ControlApiFixtures.executionValidation.response.data,
          executionPlan: {
            ...ControlApiFixtures.executionValidation.response.data.executionPlan,
            mutable: true,
          },
        },
      })
    ).toEqual(ControlApiFixtures.executionValidation.response)
  })

  test('accepts additive fields without exposing them and rejects ambient scopes', () => {
    const response = ProfileResolutionResponseSchema.parse({
      ...ControlApiFixtures.profileResolution.response,
      data: {
        ...ControlApiFixtures.profileResolution.response.data,
        profile: {
          ...ControlApiFixtures.profileResolution.response.data.profile,
          optionalFutureField: 'future-compatible',
        },
      },
    })
    expect(response).toEqual(ControlApiFixtures.profileResolution.response)

    expect(
      ServiceAuthenticationResponseSchema.safeParse({
        ...ControlApiFixtures.authentication.response,
        data: {
          ...ControlApiFixtures.authentication.response.data,
          principal: {
            ...ControlApiFixtures.authentication.response.data.principal,
            scopes: ['*'],
          },
        },
      }).success
    ).toBe(false)
  })
})

import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import {
  ControlApiFixtures,
  ControlPlaneClient,
  ControlPlaneClientError,
  PublicContractManifest,
} from './index.ts'

describe('Control Plane SDK public client', () => {
  test('sends validated requests with service authentication and correlation headers', async () => {
    const calls = []
    const client = new ControlPlaneClient({
      baseUrl: 'https://control-plane.test/root/',
      credential: async () => 'service-token',
      fetch: async (url, init) => {
        calls.push({ url, init })
        return globalThis.Response.json(ControlApiFixtures.profileResolution.response)
      },
    })

    const response = await client.resolveProfile(ControlApiFixtures.profileResolution.request)

    expect(response).toEqual(ControlApiFixtures.profileResolution.response)
    expect(calls).toHaveLength(1)
    expect(String(calls[0].url)).toBe('https://control-plane.test/root/v1/profiles/resolve')
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.redirect).toBe('error')
    expect(calls[0].init.headers).toEqual({
      accept: 'application/json',
      authorization: 'Bearer service-token',
      'content-type': 'application/json',
      'x-correlation-id': 'trc_01JABCDEF0123456789ABCDEFG',
      'x-request-id': 'req_01JABCDEF0123456789ABCDEFG',
    })
  })

  test('protects service credentials from insecure remote transport', () => {
    expect(
      () =>
        new ControlPlaneClient({
          baseUrl: 'http://control-plane.test',
          credential: 'service-token',
        })
    ).toThrow('HTTPS')

    expect(
      () =>
        new ControlPlaneClient({
          baseUrl: 'http://127.0.0.1:4321',
          credential: 'stub-token',
        })
    ).not.toThrow()
  })

  test('fails closed on normalized server errors without retaining credentials', async () => {
    const client = new ControlPlaneClient({
      baseUrl: 'https://control-plane.test',
      credential: 'super-secret-token',
      fetch: async () =>
        globalThis.Response.json(
          {
            ...ControlApiFixtures.authentication.response,
            data: undefined,
            error: {
              class: 'authentication',
              code: 'SERVICE_CREDENTIAL_REVOKED',
              message: 'Service credential is not accepted',
              retryable: false,
            },
          },
          { status: 401 }
        ),
    })

    await expect(
      client.verifyAuthentication(ControlApiFixtures.authentication.request)
    ).rejects.toMatchObject({
      name: 'ControlPlaneClientError',
      code: 'SERVICE_CREDENTIAL_REVOKED',
      errorClass: 'authentication',
      retryable: false,
      status: 401,
    })

    try {
      await client.verifyAuthentication(ControlApiFixtures.authentication.request)
    } catch (error) {
      expect(error).toBeInstanceOf(ControlPlaneClientError)
      expect(JSON.stringify(error)).not.toContain('super-secret-token')
    }
  })

  test('rejects malformed success payloads and incompatible contract majors', async () => {
    const malformedClient = new ControlPlaneClient({
      baseUrl: 'https://control-plane.test',
      credential: 'token',
      fetch: async () => globalThis.Response.json({ data: { profile: { databaseId: 42 } } }),
    })
    await expect(
      malformedClient.resolveProfile(ControlApiFixtures.profileResolution.request)
    ).rejects.toMatchObject({ code: 'INVALID_CONTROL_PLANE_RESPONSE', retryable: false })

    const incompatibleClient = new ControlPlaneClient({
      baseUrl: 'https://control-plane.test',
      credential: 'token',
      fetch: async () =>
        globalThis.Response.json({
          ...ControlApiFixtures.runtimeList.response,
          contractVersion: { major: 2, minor: 0 },
        }),
    })
    await expect(
      incompatibleClient.listRuntimes(ControlApiFixtures.runtimeList.request)
    ).rejects.toMatchObject({ code: 'INCOMPATIBLE_CONTRACT_VERSION', retryable: false })
  })

  test('publishes only the contracts dependency and stable public entry points', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    const publicModule = await import('./index.ts')
    const serializedExports = Object.keys(publicModule).join(' ').toLowerCase()

    expect(manifest).toMatchObject({
      name: '@control-plane/sdk',
      version: '1.0.0',
      license: 'Apache-2.0',
      dependencies: { '@control-plane/contracts': 'workspace:^' },
      publishConfig: { access: 'public', provenance: true },
    })
    expect(manifest.private).toBeUndefined()
    expect(PublicContractManifest.current).toEqual({ major: 1, minor: 0 })
    for (const prohibited of [
      'database',
      'drizzle',
      'temporal',
      'langgraph',
      'secret-manager',
      'executionplancompiler',
    ]) {
      expect(serializedExports).not.toContain(prohibited)
      expect(JSON.stringify(manifest).toLowerCase()).not.toContain(prohibited)
    }
  })
})

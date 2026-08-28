import { describe, expect, test } from 'bun:test'
import { loadManagedCloudConfiguration, managedCloudEnvironmentManifest } from './index.ts'

const metadata = {
  APP_ENV: 'staging',
  SERVICE_VERSION: '1.0.0',
  COMMIT_SHA: 'abc123',
  INSTANCE_ID: 'staging-1',
}

const cloud = {
  ...metadata,
  DATABASE_URL: 'postgresql://app:database-secret@example.neon.tech/control_plane?sslmode=require',
  CONTROL_PLANE_SECRET_ENCRYPTION_KEY:
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  CONTROL_PLANE_SERVICE_AUTH_TOKEN: 'service-token-that-is-at-least-32-characters',
  RESTATE_INGRESS_URL: 'http://control-planerestate.railway.internal:8080',
  RESTATE_REQUEST_IDENTITY_PUBLIC_KEY: 'publickeyv1_w7YHemBctH5Ck2nQRQ47iBBqhNHy4FV7t2Usbye2A6f',
  R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  R2_BUCKET: 'ctrl-plane',
  R2_REGION: 'auto',
  R2_ACCESS_KEY_ID: 'access-key',
  R2_SECRET_ACCESS_KEY: 'secret-key-that-is-not-logged',
}

describe('managed cloud configuration', () => {
  test('publishes a per-service dependency manifest', () => {
    expect(managedCloudEnvironmentManifest()['control-api']).toContain('RESTATE_INGRESS_URL')
    expect(managedCloudEnvironmentManifest()['workflow-worker']).toContain(
      'RESTATE_REQUEST_IDENTITY_PUBLIC_KEY'
    )
    expect(managedCloudEnvironmentManifest()['workflow-worker']).not.toContain(
      'RESTATE_INGRESS_URL'
    )
    expect(JSON.stringify(managedCloudEnvironmentManifest())).not.toContain(
      'RESTATE_SERVICE_AUTH_TOKEN'
    )
    expect(managedCloudEnvironmentManifest()['runtime-gateway']).toEqual([
      'CONTROL_PLANE_SERVICE_AUTH_TOKEN',
    ])
  })

  test('loads Railway, Neon, Restate, and R2 configuration without changing provider-neutral types', () => {
    const configuration = loadManagedCloudConfiguration(cloud, 'control-api')
    expect(configuration).toMatchObject({
      service: 'control-api',
      database: { role: 'application' },
      restate: {
        role: 'caller',
        ingressUrl: 'http://control-planerestate.railway.internal:8080',
      },
      objectStore: { bucket: 'ctrl-plane', region: 'auto' },
    })

    expect(loadManagedCloudConfiguration(cloud, 'workflow-worker')).toMatchObject({
      service: 'workflow-worker',
      restate: {
        role: 'endpoint',
        requestIdentityPublicKey: 'publickeyv1_w7YHemBctH5Ck2nQRQ47iBBqhNHy4FV7t2Usbye2A6f',
      },
    })
  })

  test('accepts only HTTPS or Railway-private HTTP Restate ingress', () => {
    expect(() =>
      loadManagedCloudConfiguration(
        { ...cloud, RESTATE_INGRESS_URL: 'http://restate.example.com' },
        'control-api'
      )
    ).toThrow()
    expect(() =>
      loadManagedCloudConfiguration(
        { ...cloud, RESTATE_INGRESS_URL: 'http://control-planerestate.railway.internal:9070' },
        'control-api'
      )
    ).toThrow()
  })

  test('reports missing names without exposing secret values', () => {
    try {
      loadManagedCloudConfiguration({ ...cloud, R2_SECRET_ACCESS_KEY: undefined }, 'control-api')
      throw new Error('Expected configuration failure')
    } catch (error) {
      expect(error.diagnostic.missing).toContain('R2_SECRET_ACCESS_KEY')
      expect(JSON.stringify(error)).not.toContain('secret-key')
    }
  })
})

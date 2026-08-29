import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TextDecoder, TextEncoder } from 'node:util'
import {
  CompositeSecretsProvider,
  EnvironmentSecretsProvider,
  HostSecureHandleSecretsProvider,
  PrivateFileSecretsProvider,
} from './index.ts'

const providers = []
afterEach(async () => {
  await Promise.all(providers.splice(0).map(async (provider) => provider.close()))
})

describe('Local and Hosted secrets providers', () => {
  test('resolves only explicitly mapped environment references and zeroizes leases', async () => {
    const provider = new EnvironmentSecretsProvider({
      references: { model: 'MODEL_TOKEN' },
      environment: { MODEL_TOKEN: 'secret-canary' },
    })
    providers.push(provider)
    const lease = await provider.resolve({ provider: 'env', key: 'model' }, { purpose: 'model' })
    expect(new TextDecoder().decode(lease.value)).toBe('secret-canary')
    expect(JSON.stringify(lease)).not.toContain('secret-canary')
    lease.close()
    expect(lease.value.every((value) => value === 0)).toBe(true)
    await expect(
      provider.resolve({ provider: 'env', key: 'unmapped' }, { purpose: 'model' })
    ).rejects.toMatchObject({ code: 'SECRET_REFERENCE_INVALID' })
  })

  test('accepts owner-only private files and rejects unsafe modes and symlinks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'control-plane-secrets-'))
    await chmod(root, 0o700)
    await writeFile(join(root, 'safe'), 'private', { mode: 0o600 })
    await writeFile(join(root, 'open'), 'unsafe', { mode: 0o644 })
    await symlink(join(root, 'safe'), join(root, 'link'))
    const provider = new PrivateFileSecretsProvider({ rootDirectory: root })
    providers.push(provider)

    const secret = await provider.resolve({ provider: 'file', key: 'safe' }, { purpose: 'test' })
    expect(new TextDecoder().decode(secret.value)).toBe('private')
    secret.close()
    await expect(
      provider.resolve({ provider: 'file', key: 'open' }, { purpose: 'test' })
    ).rejects.toMatchObject({ code: 'SECRET_FILE_UNSAFE' })
    await expect(
      provider.resolve({ provider: 'file', key: 'link' }, { purpose: 'test' })
    ).rejects.toMatchObject({ code: 'SECRET_FILE_UNSAFE' })
  })

  test('delegates opaque host handles with bounded use context', async () => {
    const uses = []
    const provider = new HostSecureHandleSecretsProvider({
      resolve: async (handle, use) => {
        uses.push([handle, use])
        return new TextEncoder().encode('host-secret')
      },
      health: async () => true,
      close: () => undefined,
    })
    providers.push(provider)
    const use = { purpose: 'provider-auth', workspaceId: 'workspace-1', operation: 'invoke' }
    const secret = await provider.resolve({ provider: 'host-secure', key: 'handle-1' }, use)
    expect(uses).toEqual([['handle-1', use]])
    secret.close()
  })

  test('routes by provider without exposing unsupported references', async () => {
    const environment = new EnvironmentSecretsProvider({
      references: { key: 'KEY' },
      environment: { KEY: 'value' },
    })
    const composite = new CompositeSecretsProvider({ env: environment })
    providers.push(composite)
    expect(await composite.health()).toMatchObject({ ready: true, details: { providers: 1 } })
    await expect(
      composite.resolve({ provider: 'unknown', key: 'key' }, { purpose: 'test' })
    ).rejects.toMatchObject({ code: 'SECRET_PROVIDER_UNSUPPORTED' })
  })
})

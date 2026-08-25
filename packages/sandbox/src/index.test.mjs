import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import {
  E2bSandboxAdapter,
  FakeArtifactPromoter,
  FakeE2bClient,
  FakeSandboxProvider,
  SandboxCoordinator,
  SandboxError,
} from './index.js'

const ids = {
  workspaceId: 'wsp_01JABCDEF0123456789ABCDEFG',
  executionId: 'exe_01JABCDEF0123456789ABCDEFG',
  attemptId: 'att_01JABCDEF0123456789ABCDEFG',
}

const policy = {
  template: 'node-24',
  timeoutMs: 10_000,
  limits: { cpuCount: 2, memoryMb: 1024, storageMb: 2048, outputBytes: 4096 },
  network: { mode: 'allowlist', allowedHosts: ['registry.npmjs.org'] },
}

const createRequest = { ...ids, policy }

describe('sandbox provider', () => {
  test('keeps the E2B SDK outside the provider-neutral package contract', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    expect(JSON.stringify(manifest.dependencies)).not.toMatch(/@e2b|e2b-sdk/i)
  })

  test('uses a replaceable provider contract with bounded normalized execution', async () => {
    for (const provider of [new FakeSandboxProvider(), new FakeSandboxProvider('alternate')]) {
      const coordinator = new SandboxCoordinator({ provider, promoter: new FakeArtifactPromoter() })
      const sandbox = await coordinator.create(createRequest)
      const result = await coordinator.execute({
        sandboxId: sandbox.sandboxId,
        command: ['bun', '--version'],
        environment: {},
        timeoutMs: 1_000,
      })

      expect(result).toMatchObject({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false })
      expect(await coordinator.status(sandbox.sandboxId)).toMatchObject({ state: 'ready' })
      await coordinator.destroy(sandbox.sandboxId, 'completed')
      expect(await coordinator.status(sandbox.sandboxId)).toMatchObject({ state: 'destroyed' })
    }
  })

  test('E2B adapter forwards only declared resources, network, and ephemeral credentials', async () => {
    const client = new FakeE2bClient()
    const provider = new E2bSandboxAdapter({
      client,
      resolveCredential: async (leaseId) =>
        leaseId === 'crl_01JABCDEF0123456789ABCDEFG' ? 'temporary-secret' : undefined,
    })
    const coordinator = new SandboxCoordinator({ provider, promoter: new FakeArtifactPromoter() })
    const sandbox = await coordinator.create(createRequest)
    await coordinator.execute({
      sandboxId: sandbox.sandboxId,
      command: ['curl', 'https://registry.npmjs.org'],
      environment: { MODE: 'test' },
      credentialBindings: [
        {
          leaseId: 'crl_01JABCDEF0123456789ABCDEFG',
          environmentName: 'REGISTRY_TOKEN',
        },
      ],
      timeoutMs: 1_000,
    })

    expect(client.created[0]).toEqual({
      template: 'node-24',
      timeoutMs: 10_000,
      cpuCount: 2,
      memoryMb: 1024,
      storageMb: 2048,
      network: { mode: 'allowlist', allowedHosts: ['registry.npmjs.org'] },
      metadata: ids,
    })
    expect(client.commands[0].environment).toEqual({
      MODE: 'test',
      REGISTRY_TOKEN: 'temporary-secret',
    })
    expect(JSON.stringify(await coordinator.status(sandbox.sandboxId))).not.toContain(
      'temporary-secret'
    )
  })

  test('denies ambient metadata, undeclared network, and unleased credentials by default', async () => {
    const provider = new FakeSandboxProvider()
    const coordinator = new SandboxCoordinator({ provider, promoter: new FakeArtifactPromoter() })
    const sandbox = await coordinator.create(createRequest)

    for (const input of [
      {
        sandboxId: sandbox.sandboxId,
        command: ['curl', 'http://169.254.169.254/latest/meta-data'],
        environment: {},
        timeoutMs: 1_000,
      },
      {
        sandboxId: sandbox.sandboxId,
        command: ['curl', 'https://example.com'],
        environment: {},
        timeoutMs: 1_000,
      },
      {
        sandboxId: sandbox.sandboxId,
        command: ['env'],
        environment: { AWS_SECRET_ACCESS_KEY: 'ambient' },
        timeoutMs: 1_000,
      },
    ]) {
      await expect(coordinator.execute(input)).rejects.toMatchObject({ code: 'POLICY_DENIED' })
    }
    expect(provider.executions).toHaveLength(0)
  })

  test('tears down deterministically after timeout, failure, and cancellation', async () => {
    for (const mode of ['timeout', 'failure', 'cancelled']) {
      const provider = new FakeSandboxProvider()
      provider.nextExecution = mode
      const coordinator = new SandboxCoordinator({
        provider,
        promoter: new FakeArtifactPromoter(),
      })
      const sandbox = await coordinator.create(createRequest)
      await expect(
        coordinator.execute({
          sandboxId: sandbox.sandboxId,
          command: ['run'],
          environment: {},
          timeoutMs: 1_000,
        })
      ).rejects.toBeInstanceOf(SandboxError)
      expect(provider.destroyed).toEqual([{ sandboxId: sandbox.sandboxId, reason: mode }])
    }
  })

  test('persists output only through explicitly authorized artifact promotion', async () => {
    const provider = new FakeSandboxProvider()
    const promoter = new FakeArtifactPromoter()
    const coordinator = new SandboxCoordinator({ provider, promoter })
    const sandbox = await coordinator.create(createRequest)
    await coordinator.upload({
      sandboxId: sandbox.sandboxId,
      path: '/workspace/report.txt',
      content: new Uint8Array([111, 107]),
    })

    await expect(
      coordinator.promote({ sandboxId: sandbox.sandboxId, path: '/workspace/report.txt' })
    ).rejects.toMatchObject({ code: 'PROMOTION_DENIED' })
    promoter.authorized = true
    expect(
      await coordinator.promote({ sandboxId: sandbox.sandboxId, path: '/workspace/report.txt' })
    ).toMatchObject({
      artifactId: 'art_01JABCDEF0123456789ABCDEFG',
      locator: 'artifact://sandbox/report',
    })
  })

  test('reaps abandoned instances idempotently while preserving active instances', async () => {
    let now = Date.parse('2026-08-25T12:00:00.000Z')
    const provider = new FakeSandboxProvider({ now: () => new Date(now).toISOString() })
    const coordinator = new SandboxCoordinator({
      provider,
      promoter: new FakeArtifactPromoter(),
      now: () => new Date(now).toISOString(),
    })
    const abandoned = await coordinator.create(createRequest)
    now += 20_000
    const active = await coordinator.create(createRequest)

    expect(await coordinator.reap({ olderThanMs: 15_000 })).toEqual([abandoned.sandboxId])
    expect(await coordinator.reap({ olderThanMs: 15_000 })).toEqual([])
    expect(await coordinator.status(active.sandboxId)).toMatchObject({ state: 'ready' })
  })
})

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { HostedServerControlPlaneComposition, resolveHostedApiHost } from './index.ts'

describe('Hosted server composition', () => {
  test('reports PostgreSQL and separate Restate dependencies without changing core contracts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'control-plane-hosted-'))
    const calls = []
    const connection = {
      database: {},
      check: async () => calls.push('database:check'),
      close: async () => calls.push('database:close'),
    }
    const workflow = {
      profile: 'hosted-server',
      start: async () => calls.push('workflow:start'),
      health: async () => ({ ready: true, component: 'restate', version: '1.7.7' }),
      stop: async () => calls.push('workflow:stop'),
    }
    const composition = new HostedServerControlPlaneComposition({
      dataDirectory: directory,
      databaseUrl: 'postgresql://app:secret@postgres/control_plane',
      connection,
      workflowRuntime: workflow,
      remoteControlFactory: (acceptance) => {
        expect(typeof acceptance.accept).toBe('function')
        return {
          start: async () => calls.push('relay:start'),
          stop: () => calls.push('relay:stop'),
          health: async () => ({
            ready: true,
            component: 'remote-control-relay',
            version: '1',
            details: { direction: 'outbound', listener: false },
          }),
        }
      },
      endpointFactory: {
        create: async () => ({
          run: async () => calls.push('endpoint:start'),
          shutdown: async () => calls.push('endpoint:stop'),
        }),
      },
    })
    try {
      await composition.start()
      expect(await composition.manifest()).toMatchObject({
        profile: 'hosted-server',
        topology: {
          externalServices: 2,
          persistence: 'postgresql',
          objectStore: 'filesystem',
          runtimeTransport: 'unconfigured',
          remoteControl: 'outbound',
        },
      })
      expect((await composition.discovery.resolve('postgresql')).url.toString()).toBe(
        'postgresql://postgres/control_plane'
      )
      expect(calls).toEqual([
        'database:check',
        'endpoint:start',
        'workflow:start',
        'relay:start',
        'database:check',
      ])
    } finally {
      await composition.close()
      await rm(directory, { recursive: true, force: true })
    }
    expect(calls).toEqual([
      'database:check',
      'endpoint:start',
      'workflow:start',
      'relay:start',
      'database:check',
      'relay:stop',
      'workflow:stop',
      'endpoint:stop',
      'database:close',
    ])
  })

  test('keeps host publication loopback unless explicitly bound by the container profile', () => {
    expect(resolveHostedApiHost()).toBe('127.0.0.1')
    expect(resolveHostedApiHost('0.0.0.0')).toBe('0.0.0.0')
    expect(() => resolveHostedApiHost('public.example.com')).toThrow(
      'HOSTED_CONTROL_PLANE_BIND_HOST_INVALID'
    )
  })
})

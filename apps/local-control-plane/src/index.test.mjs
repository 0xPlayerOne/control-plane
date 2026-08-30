import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { DirectLocalRuntimeTransport, TransportedRuntimeAdapter } from '@control-plane/runtime-sdk'
import { FilesystemObjectStore } from '@control-plane/object-store'
import { SqlitePersistenceProvider } from '@control-plane/sqlite-persistence'
import {
  DirectRuntimeExecutionActivities,
  LocalApiServer,
  LocalControlPlaneComposition,
  createLocalApiAuthentication,
  resolveEmbeddedDeploymentProfile,
  resolveLocalApiHost,
} from './index.ts'

describe('Local Control Plane composition', () => {
  test('binds loopback by default and permits only explicit socket bind addresses', () => {
    expect(resolveLocalApiHost()).toBe('127.0.0.1')
    expect(resolveLocalApiHost('0.0.0.0')).toBe('0.0.0.0')
    expect(() => resolveLocalApiHost('public.example.com')).toThrow(
      'LOCAL_CONTROL_PLANE_BIND_HOST_INVALID'
    )
  })

  test('reports hosted-simple only when explicitly selected', () => {
    expect(resolveEmbeddedDeploymentProfile()).toBe('local')
    expect(resolveEmbeddedDeploymentProfile('hosted-simple')).toBe('hosted-simple')
    expect(() => resolveEmbeddedDeploymentProfile('hosted-server')).toThrow(
      'EMBEDDED_DEPLOYMENT_PROFILE_INVALID'
    )
  })

  test('starts one zero-external-service topology with durable local adapters', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'control-plane-local-'))
    const calls = []
    const workflow = {
      profile: 'local',
      start: async () => calls.push('workflow:start'),
      health: async () => ({ ready: true, component: 'restate', version: '1.7.7' }),
      stop: async () => calls.push('workflow:stop'),
    }
    const composition = new LocalControlPlaneComposition({
      dataDirectory: directory,
      workflowRuntime: workflow,
      runtimeTransport: { transportKind: 'direct-local' },
      endpointFactory: {
        create: async () => ({
          run: async () => calls.push('endpoint:start'),
          shutdown: async () => calls.push('endpoint:stop'),
        }),
      },
    })
    try {
      await composition.start()
      const manifest = await composition.manifest()
      expect(calls).toEqual(['endpoint:start', 'workflow:start'])
      expect(manifest).toMatchObject({
        schemaVersion: 1,
        profile: 'local',
        topology: {
          externalServices: 0,
          runtimeTransport: 'direct-local',
          persistence: 'sqlite',
          objectStore: 'filesystem',
          remoteControl: 'disabled',
        },
      })
      expect(manifest.components.every(({ ready }) => ready)).toBe(true)
      expect((await composition.discovery.resolve('restate')).private).toBe(true)
    } finally {
      await composition.close()
      await rm(directory, { recursive: true, force: true })
    }
    expect(calls).toEqual(['endpoint:start', 'workflow:start', 'workflow:stop', 'endpoint:stop'])
  })

  test('exposes loopback-only component health through the versioned API boundary', async () => {
    const manifest = {
      schemaVersion: 1,
      profile: 'local',
      version: '1.0.0',
      dataDirectory: '/tmp/control-plane',
      components: [{ ready: true, component: 'sqlite-persistence', version: '1' }],
      topology: {
        externalServices: 0,
        runtimeTransport: 'direct-local',
        restateVersion: '1.7.7',
        persistence: 'sqlite',
        objectStore: 'filesystem',
        remoteControl: 'disabled',
      },
    }
    const server = new LocalApiServer({
      port: 0,
      manifest: async () => manifest,
      health: () => ({ status: 'ok', metadata: { serviceName: 'local-control-plane' } }),
      readiness: () => ({ status: 'ready', metadata: { serviceName: 'local-control-plane' } }),
    })
    try {
      await server.start()
      const response = await globalThis.fetch(`${server.address}/v1/components`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(manifest)
    } finally {
      await server.close()
    }
  })

  test('constructs and starts optional outbound remote control against durable acceptance', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'control-plane-local-relay-'))
    const calls = []
    const composition = new LocalControlPlaneComposition({
      dataDirectory: directory,
      workflowRuntime: {
        profile: 'local',
        start: async () => calls.push('workflow:start'),
        health: async () => ({ ready: true, component: 'restate', version: '1.7.7' }),
        stop: async () => calls.push('workflow:stop'),
      },
      endpointFactory: {
        create: async () => ({
          run: async () => calls.push('endpoint:start'),
          shutdown: async () => calls.push('endpoint:stop'),
        }),
      },
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
    })
    try {
      await composition.start()
      expect(await composition.manifest()).toMatchObject({
        topology: { remoteControl: 'outbound' },
      })
      expect(calls).toEqual(['endpoint:start', 'workflow:start', 'relay:start'])
    } finally {
      await composition.close()
      await rm(directory, { recursive: true, force: true })
    }
    expect(calls).toEqual([
      'endpoint:start',
      'workflow:start',
      'relay:start',
      'relay:stop',
      'workflow:stop',
      'endpoint:stop',
    ])
  })

  test('executes and replays a completed runtime effect through direct transport only', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'control-plane-direct-runtime-'))
    const persistence = new SqlitePersistenceProvider({
      path: join(directory, 'control-plane.sqlite'),
    })
    const objectStore = new FilesystemObjectStore({
      rootDirectory: join(directory, 'artifacts'),
      maxObjectBytes: 1024 * 1024,
    })
    const handle = {
      handleId: 'local:att_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      attemptId: 'att_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      startedAt: '2026-08-29T00:00:00.000Z',
    }
    let starts = 0
    const driver = {
      start: async () => {
        starts += 1
        return handle
      },
      progress: async function* () {},
      status: async () => ({
        handle,
        state: 'completed',
        observedAt: '2026-08-29T00:00:01.000Z',
        result: {
          outcome: 'completed',
          output: { ok: true },
          usage: { inputTokens: 1, outputTokens: 1, durationMs: 10 },
          artifacts: [],
        },
      }),
      cleanup: async () => undefined,
    }
    const transport = new DirectLocalRuntimeTransport(driver)
    const adapter = new TransportedRuntimeAdapter(transport, 'test')
    const activities = new DirectRuntimeExecutionActivities(persistence, objectStore, adapter, {
      get: async () => ({
        schemaVersion: 1,
        executionPlanId: 'pln_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        contentDigest: `sha256:${'a'.repeat(64)}`,
        runtimeRequirements: [],
      }),
    })
    try {
      await persistence.migrate()
      const input = {
        executionId: 'exe_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        attemptId: handle.attemptId,
        executionPlan: {
          executionPlanId: 'pln_01ARZ3NDEKTSV4RRFFQ69G5FAV',
          contentDigest: `sha256:${'a'.repeat(64)}`,
          schemaVersion: 1,
        },
        effectKey: 'wfl_01ARZ3NDEKTSV4RRFFQ69G5FAV:execution-lifecycle-v1:dispatch',
      }
      const first = await activities.dispatch(input)
      const replay = await activities.dispatch(input)
      expect(first).toEqual(replay)
      expect(first).toMatchObject({ outcome: 'completed' })
      expect(starts).toBe(1)
      expect(
        (await objectStore.get(first.resultReference.slice('object://'.length))).body
      ).toBeTruthy()
    } finally {
      persistence.close()
      objectStore.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('keeps the loopback API credential outside SQLite in an owner-only file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'control-plane-local-auth-'))
    try {
      const authentication = await createLocalApiAuthentication(directory)
      const credential = (await readFile(authentication.credentialFile, 'utf8')).trim()
      expect((await stat(authentication.credentialFile)).mode & 0o077).toBe(0)
      await expect(
        authentication.authenticator.authenticate(
          {
            headers: { authorization: `Bearer ${credential}` },
            body: {
              caller: { servicePrincipalId: 'svc_agent-hq' },
              workspaceId: 'wsp_01ARZ3NDEKTSV4RRFFQ69G5FAV',
              projectId: 'prj_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            },
          },
          ['execution:accept']
        )
      ).resolves.toMatchObject({ principalId: 'svc_agent-hq' })
      await expect(
        authentication.authenticator.authenticate(
          { headers: { authorization: 'Bearer invalid' }, body: {} },
          ['execution:accept']
        )
      ).rejects.toMatchObject({ status: 401 })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

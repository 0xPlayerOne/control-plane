import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqlitePersistenceError, SqlitePersistenceProvider } from './index.ts'

const providers = []

afterEach(() => {
  for (const provider of providers.splice(0)) provider.close()
})

async function provider() {
  const directory = await mkdtemp(join(tmpdir(), 'control-plane-sqlite-'))
  const instance = new SqlitePersistenceProvider({
    path: join(directory, 'control-plane.sqlite'),
    now: () => new Date('2026-08-29T00:00:00.000Z'),
  })
  providers.push(instance)
  await instance.migrate()
  return { directory, instance }
}

describe('SQLite persistence provider', () => {
  test('uses WAL, owner-only files, and optimistic durable records', async () => {
    const { directory, instance } = await provider()
    const created = await instance.transaction((transaction) =>
      transaction.put({ namespace: 'project-state', id: 'item-1', value: { status: 'ready' } })
    )
    expect(created.revision).toBe(1)
    expect(
      await instance.transaction((transaction) => transaction.get('project-state', 'item-1'))
    ).toEqual(created)

    const updated = await instance.transaction((transaction) =>
      transaction.put({
        namespace: 'project-state',
        id: 'item-1',
        expectedRevision: 1,
        value: { status: 'complete' },
      })
    )
    expect(updated.revision).toBe(2)
    expect((await stat(join(directory, 'control-plane.sqlite'))).mode & 0o777).toBe(0o600)
    expect((await stat(directory)).mode & 0o777).toBe(0o700)
    expect(await instance.health()).toMatchObject({ ready: true, component: 'sqlite-persistence' })
  })

  test('fails closed on stale revisions and rolls the transaction back', async () => {
    const { instance } = await provider()
    await instance.transaction((transaction) =>
      transaction.put({ namespace: 'executions', id: 'execution-1', value: { state: 'queued' } })
    )

    await expect(
      instance.transaction(async (transaction) => {
        await transaction.put({
          namespace: 'executions',
          id: 'execution-1',
          expectedRevision: 1,
          value: { state: 'running' },
        })
        await transaction.put({
          namespace: 'executions',
          id: 'execution-1',
          expectedRevision: 1,
          value: { state: 'completed' },
        })
      })
    ).rejects.toMatchObject({ code: 'SQLITE_REVISION_CONFLICT' })

    expect(
      await instance.transaction((transaction) => transaction.get('executions', 'execution-1'))
    ).toMatchObject({ revision: 1, value: { state: 'queued' } })
  })

  test('backs up and restores a digest-verified database', async () => {
    const { directory, instance } = await provider()
    await instance.transaction((transaction) =>
      transaction.put({ namespace: 'commands', id: 'command-1', value: { status: 'accepted' } })
    )
    const snapshot = await instance.backup()
    expect(snapshot.bytes.byteLength).toBeGreaterThan(0)

    await instance.transaction((transaction) => transaction.delete('commands', 'command-1', 1))
    await instance.restore(snapshot)
    expect(
      await instance.transaction((transaction) => transaction.get('commands', 'command-1'))
    ).toMatchObject({ revision: 1, value: { status: 'accepted' } })
    expect((await readFile(join(directory, 'control-plane.sqlite'))).byteLength).toBeGreaterThan(0)
  })

  test('rejects in-memory paths and tampered backups', async () => {
    expect(() => new SqlitePersistenceProvider({ path: ':memory:' })).toThrow(
      SqlitePersistenceError
    )
    const { instance } = await provider()
    const snapshot = await instance.backup()
    await expect(
      instance.restore({ ...snapshot, bytes: new Uint8Array([1, 2, 3]) })
    ).rejects.toMatchObject({ code: 'SQLITE_BACKUP_INVALID' })
  })
})

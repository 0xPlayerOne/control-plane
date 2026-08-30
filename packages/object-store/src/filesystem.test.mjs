import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TextEncoder } from 'node:util'
import { FilesystemObjectStore } from './filesystem.ts'

const stores = []
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
})

async function store() {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'control-plane-objects-'))
  const instance = new FilesystemObjectStore({ rootDirectory, maxObjectBytes: 1024 })
  stores.push(instance)
  return { rootDirectory, instance }
}

describe('FilesystemObjectStore', () => {
  test('preserves ObjectStore identity, metadata, integrity, and owner-only permissions', async () => {
    const { rootDirectory, instance } = await store()
    const body = new TextEncoder().encode('local artifact')
    const descriptor = await instance.put({
      key: 'artifacts/execution-1/result.json',
      body,
      contentType: 'application/json',
      metadata: { execution: 'execution-1' },
    })
    expect(await instance.head(descriptor.key)).toEqual(descriptor)
    expect(await instance.get(descriptor.key)).toEqual({ ...descriptor, body })
    const objectPath = join(rootDirectory, 'artifacts/execution-1/result.json')
    expect((await stat(objectPath)).mode & 0o777).toBe(0o600)
    expect((await stat(`${objectPath}.control-plane.json`)).mode & 0o777).toBe(0o600)
  })

  test('rejects traversal and oversized bodies', async () => {
    const { instance } = await store()
    await expect(instance.put({ key: '../escape', body: new Uint8Array() })).rejects.toMatchObject({
      code: 'OBJECT_STORE_INVALID_INPUT',
    })
    await expect(instance.put({ key: 'large', body: new Uint8Array(1025) })).rejects.toMatchObject({
      code: 'OBJECT_STORE_TOO_LARGE',
    })
  })

  test('detects body tampering and deletes both files idempotently', async () => {
    const { rootDirectory, instance } = await store()
    await instance.put({ key: 'artifact', body: new TextEncoder().encode('trusted') })
    await writeFile(join(rootDirectory, 'artifact'), 'tampered')
    await chmod(join(rootDirectory, 'artifact'), 0o600)
    await expect(instance.get('artifact')).rejects.toMatchObject({
      code: 'OBJECT_STORE_INTEGRITY_FAILURE',
    })
    await instance.delete('artifact')
    await instance.delete('artifact')
    await expect(instance.head('artifact')).rejects.toMatchObject({
      code: 'OBJECT_STORE_NOT_FOUND',
    })
  })
})

import { describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createFilesystemCheckpoint,
  restoreFilesystemCheckpoint,
  verifyFilesystemCheckpoint,
} from './checkpoint.ts'

describe('filesystem checkpoints', () => {
  test('creates, verifies, and restores an owner-controlled Local checkpoint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'control-plane-checkpoint-'))
    const source = join(root, 'source')
    const checkpoint = join(root, 'checkpoint')
    const restored = join(root, 'restored')
    try {
      await mkdir(join(source, 'artifacts'), { recursive: true, mode: 0o700 })
      await writeFile(join(source, 'control-plane.sqlite'), 'sqlite-state', { mode: 0o600 })
      await writeFile(join(source, 'artifacts', 'result.bin'), 'artifact', { mode: 0o600 })
      const created = await createFilesystemCheckpoint({
        sourceDirectory: source,
        destinationDirectory: checkpoint,
        profile: 'local',
      })
      expect(created).toMatchObject({ schemaVersion: 1, profile: 'local' })
      expect(await verifyFilesystemCheckpoint(checkpoint)).toEqual(created)
      expect(
        await restoreFilesystemCheckpoint({
          checkpointDirectory: checkpoint,
          destinationDirectory: restored,
        })
      ).toEqual(created)
      expect(await readFile(join(restored, 'control-plane.sqlite'), 'utf8')).toBe('sqlite-state')
      expect(await readFile(join(restored, 'artifacts', 'result.bin'), 'utf8')).toBe('artifact')
      await expect(readFile(join(restored, '.control-plane-checkpoint.json'))).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rejects tampering, symlinks, and overlapping destinations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'control-plane-checkpoint-reject-'))
    const source = join(root, 'source')
    const checkpoint = join(root, 'checkpoint')
    try {
      await mkdir(source, { mode: 0o700 })
      await writeFile(join(source, 'control-plane.sqlite'), 'sqlite-state', { mode: 0o600 })
      await expect(
        createFilesystemCheckpoint({
          sourceDirectory: source,
          destinationDirectory: join(source, 'nested'),
          profile: 'local',
        })
      ).rejects.toMatchObject({ code: 'CHECKPOINT_PATH_OVERLAP' })
      await symlink(join(source, 'control-plane.sqlite'), join(source, 'state-link'))
      await expect(
        createFilesystemCheckpoint({
          sourceDirectory: source,
          destinationDirectory: checkpoint,
          profile: 'local',
        })
      ).rejects.toMatchObject({ code: 'CHECKPOINT_UNSUPPORTED_ENTRY' })
      await rm(join(source, 'state-link'))
      await createFilesystemCheckpoint({
        sourceDirectory: source,
        destinationDirectory: checkpoint,
        profile: 'local',
      })
      await chmod(join(checkpoint, 'control-plane.sqlite'), 0o600)
      await writeFile(join(checkpoint, 'control-plane.sqlite'), 'tampered')
      await expect(verifyFilesystemCheckpoint(checkpoint)).rejects.toMatchObject({
        code: 'CHECKPOINT_CONTENT_MISMATCH',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

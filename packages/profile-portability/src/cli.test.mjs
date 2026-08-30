import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqlitePersistenceProvider } from '@control-plane/sqlite-persistence'
import { runPortabilityCli } from './cli.ts'

const directories = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('profile portability CLI', () => {
  test('exports, verifies, dry-runs, applies, and idempotently replays a Local to Hosted Simple move', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'portability-cli-'))
    directories.push(directory)
    const sourcePath = join(directory, 'source.sqlite')
    const destinationPath = join(directory, 'destination.sqlite')
    const manifestPath = join(directory, 'manifest.json')
    const source = new SqlitePersistenceProvider({ path: sourcePath, profile: 'local' })
    await source.migrate()
    await source.transaction((transaction) =>
      transaction.put({
        namespace: 'agent-profiles',
        id: 'profile-cli',
        value: { profileId: 'profile-cli', revision: 1, label: 'CLI portable' },
      })
    )
    source.close()

    const output = []
    const io = { stdout: (value) => output.push(value), stderr: (value) => output.push(value) }
    expect(
      await runPortabilityCli(
        [
          'export',
          '--database',
          sourcePath,
          '--profile',
          'local',
          '--output',
          manifestPath,
          '--export-id',
          'cli-export',
        ],
        io
      )
    ).toBe(0)
    expect((await readFile(manifestPath, 'utf8')).includes('CLI portable')).toBe(true)
    expect(await runPortabilityCli(['verify', '--manifest', manifestPath], io)).toBe(0)
    expect(
      await runPortabilityCli(
        [
          'plan',
          '--database',
          destinationPath,
          '--profile',
          'hosted-simple',
          '--manifest',
          manifestPath,
        ],
        io
      )
    ).toBe(0)
    expect(
      await runPortabilityCli(
        [
          'import',
          '--database',
          destinationPath,
          '--profile',
          'hosted-simple',
          '--manifest',
          manifestPath,
        ],
        io
      )
    ).toBe(0)
    expect(
      await runPortabilityCli(
        [
          'import',
          '--database',
          destinationPath,
          '--profile',
          'hosted-simple',
          '--manifest',
          manifestPath,
          '--apply',
        ],
        io
      )
    ).toBe(0)
    expect(
      await runPortabilityCli(
        [
          'import',
          '--database',
          destinationPath,
          '--profile',
          'hosted-simple',
          '--manifest',
          manifestPath,
          '--apply',
        ],
        io
      )
    ).toBe(0)
    expect(output.join('\n')).toContain('replayed')
  })

  test('blocks export while a local execution is active', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'portability-cli-active-'))
    directories.push(directory)
    const databasePath = join(directory, 'active.sqlite')
    const provider = new SqlitePersistenceProvider({ path: databasePath, profile: 'local' })
    await provider.migrate()
    await provider.transaction((transaction) =>
      transaction.put({ namespace: 'executions', id: 'active-1', value: { state: 'running' } })
    )
    provider.close()
    const errors = []
    expect(
      await runPortabilityCli(
        ['export', '--database', databasePath, '--output', join(directory, 'blocked.json')],
        { stdout: () => undefined, stderr: (value) => errors.push(value) }
      )
    ).toBe(1)
    expect(errors.join('\n')).toContain('PORTABLE_ACTIVE_WORK')
  })
})

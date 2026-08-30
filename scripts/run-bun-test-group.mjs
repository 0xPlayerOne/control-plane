import { spawnSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { basename, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const sourceRoots = ['apps', 'packages']
const repositoryGroups = {
  e2e: [
    'tests/m2-core-domain.test.mjs',
    'tests/m3-durable-execution.test.mjs',
    'tests/m4-runtime-fabric.test.mjs',
    'tests/m5-runtime-gateway.test.mjs',
    'tests/m6-runtime-adapters.test.mjs',
    'tests/m7-tools-models-sandboxes.test.mjs',
    'tests/m8-multi-agent-orchestration.test.mjs',
    'tests/m9-cloud-certification.test.mjs',
    'tests/m9-production-hardening.test.mjs',
    'tests/m10-portability-conformance.test.mjs',
    'tests/m10-operability.test.mjs',
  ],
  smoke: [
    'tests/foundation.test.mjs',
    'tests/infrastructure.test.mjs',
    'tests/m11-requirements-ledger.test.mjs',
    'tests/repository.test.mjs',
  ],
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const paths = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name)
      return entry.isDirectory() ? walk(path) : [path]
    })
  )
  return paths.flat()
}

function isIntegrationTest(path) {
  const name = basename(path)
  return name === 'integration.test.mjs' || name.endsWith('.integration.test.mjs')
}

export async function discoverTestFiles(group) {
  if (group in repositoryGroups) return repositoryGroups[group]
  if (group !== 'unit') throw new Error(`Unknown test group: ${group}`)

  const files = (
    await Promise.all(sourceRoots.map((directory) => walk(resolve(repositoryRoot, directory))))
  )
    .flat()
    .filter((path) => path.endsWith('.test.mjs') && !isIntegrationTest(path))
    .map((path) => relative(repositoryRoot, path))
    .sort()

  if (files.length === 0) throw new Error('No unit tests were discovered.')
  return files
}

if (import.meta.main) {
  const [group, ...bunArguments] = process.argv.slice(2)
  const files = await discoverTestFiles(group)
  const collectsCoverage = bunArguments.includes('--coverage')
  const result = spawnSync(
    process.execPath,
    ['test', ...bunArguments, ...files.map((path) => `./${path}`)],
    {
      cwd: repositoryRoot,
      stdio: 'inherit',
      env: process.env,
    }
  )

  if (result.error) throw result.error
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1
  } else if (collectsCoverage) {
    const coverage = spawnSync(
      process.execPath,
      ['scripts/check-coverage.mjs', 'coverage/lcov.info'],
      {
        cwd: repositoryRoot,
        stdio: 'inherit',
        env: process.env,
      }
    )
    if (coverage.error) throw coverage.error
    process.exitCode = coverage.status ?? 1
  }
}

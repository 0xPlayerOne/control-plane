import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const containerCommand = [
  'docker',
  'buildx',
  'bake',
  '-f',
  'infrastructure/containers/docker-bake.hcl',
  'default',
  'database-migrate',
]
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const supportedFlags = new Set([
  '--skip-containers',
  '--skip-install',
  '--skip-terraform',
  '--verify-only',
])

for (const argument of process.argv.slice(2)) {
  if (!supportedFlags.has(argument)) throw new Error(`Unsupported acceptance flag: ${argument}`)
}

const flags = new Set(process.argv.slice(2))

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${command} ${arguments_.join(' ')} exited with status ${String(result.status)}`
    )
  }
}

async function verifyFoundationDependencies() {
  const milestone = JSON.parse(
    await readFile(new URL('../docs/m1-foundation.json', import.meta.url), 'utf8')
  )
  const packageManifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8')
  )
  const nodeVersion = (await readFile(new URL('../.node-version', import.meta.url), 'utf8')).trim()
  const bunVersion = (await readFile(new URL('../.bun-version', import.meta.url), 'utf8')).trim()

  if (nodeVersion !== milestone.toolchain.node) throw new Error('Pinned Node version drifted.')
  if (bunVersion !== milestone.toolchain.bun) throw new Error('Pinned Bun version drifted.')
  if (packageManifest.packageManager !== `bun@${milestone.toolchain.bun}`) {
    throw new Error('packageManager does not match the accepted Bun version.')
  }

  const issues = milestone.dependencies.map(({ issue }) => issue)
  if (JSON.stringify(issues) !== JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8])) {
    throw new Error('M1 dependency manifest must contain issues 1 through 8 in order.')
  }
  for (const dependency of milestone.dependencies) {
    if (!/^[0-9a-f]{40}$/.test(dependency.commit)) {
      throw new Error(`Issue ${String(dependency.issue)} has an invalid accepted commit.`)
    }
    const result = spawnSync('git', ['merge-base', '--is-ancestor', dependency.commit, 'HEAD'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    })
    if (result.status !== 0) {
      throw new Error(
        `M1 dependency issue ${String(dependency.issue)} is not present in the current history. ` +
          'Use a full clone and merge every dependency before running acceptance.'
      )
    }
  }
}

await verifyFoundationDependencies()

if (!flags.has('--verify-only')) {
  if (!flags.has('--skip-install')) run('bun', ['install', '--frozen-lockfile'])
  for (const script of ['format:check', 'lint', 'type-check', 'build', 'test:foundation']) {
    run('bun', ['run', script])
  }
  if (!flags.has('--skip-terraform')) run('bun', ['run', 'infra:validate'])
  if (!flags.has('--skip-containers')) {
    const [command, ...arguments_] = containerCommand
    run(command, arguments_)
  }
}

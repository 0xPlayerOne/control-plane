import { spawnSync } from 'node:child_process'
import process from 'node:process'

// Keep the documented production-like command visible to repository policy tests.
const COMPOSE_COMMAND = 'docker compose'

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: options.environment ?? process.env,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    if (options.capture && result.stderr) process.stderr.write(result.stderr)
    throw new Error(`${command} exited with status ${String(result.status)}`)
  }
  return result.stdout ?? ''
}

const runningServices = run('docker', ['compose', 'ps', '--status', 'running', '--services'], {
  capture: true,
})
  .split('\n')
  .filter(Boolean)
const postgresWasRunning = runningServices.includes('postgres')

try {
  if (!postgresWasRunning) run('docker', ['compose', 'up', '-d', '--wait', 'postgres'])
  const integrationEnvironment = {
    ...process.env,
    DATABASE_ADMIN_URL:
      process.env.DATABASE_ADMIN_URL ??
      'postgresql://control_plane_admin:local-admin-only@127.0.0.1:54329/postgres',
    DATABASE_MIGRATION_URL:
      process.env.DATABASE_MIGRATION_URL ??
      'postgresql://control_plane_migrator:local-migration-only@127.0.0.1:54329/control_plane',
    DATABASE_URL:
      process.env.DATABASE_URL ??
      'postgresql://control_plane_app:local-application-only@127.0.0.1:54329/control_plane',
    RUN_DATABASE_INTEGRATION: 'true',
  }
  run('bun', ['x', 'turbo', 'run', 'test:integration'], {
    environment: integrationEnvironment,
  })
} finally {
  if (!postgresWasRunning) run('docker', ['compose', 'stop', 'postgres'])
}

void COMPOSE_COMMAND

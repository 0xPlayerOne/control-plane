import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { PostgresEvaluationRepository } from '../packages/database/src/index.ts'
import { createIsolatedPostgres } from '../packages/testing/src/postgres.ts'

const expectedRunId = 'eval-run-restore-drill'
const expectedDigest = `sha256:${'d'.repeat(64)}`

function dockerPostgres(arguments_, options = {}) {
  const result = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', ...arguments_], {
    cwd: process.cwd(),
    encoding: options.binary ? null : 'utf8',
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const diagnostic = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8')
      : String(result.stderr ?? '')
    process.stderr.write(diagnostic)
    throw new Error(`PostgreSQL restore drill command failed with status ${String(result.status)}`)
  }
  return result.stdout
}

const source = await createIsolatedPostgres({ migrate: true })
const target = await createIsolatedPostgres({ migrate: false })

try {
  const repository = new PostgresEvaluationRepository(source.application)
  await repository.saveRun(recoveryEvidence())
  const backup = dockerPostgres(
    [
      'pg_dump',
      '--username',
      'control_plane_admin',
      '--dbname',
      source.name,
      '--format=custom',
      '--no-owner',
      '--no-privileges',
    ],
    { binary: true }
  )
  dockerPostgres(
    [
      'pg_restore',
      '--username',
      'control_plane_admin',
      '--dbname',
      target.name,
      '--no-owner',
      '--no-privileges',
      '--exit-on-error',
    ],
    { binary: true, input: backup }
  )
  const restored = String(
    dockerPostgres([
      'psql',
      '--username',
      'control_plane_admin',
      '--dbname',
      target.name,
      '--tuples-only',
      '--no-align',
      '--command',
      `SELECT eval_run_id || ':' || (evidence->'configuration'->>'executionPlanDigest') FROM evaluation_runs`,
    ])
  ).trim()
  if (restored !== `${expectedRunId}:${expectedDigest}`) {
    throw new Error('PostgreSQL restore drill lost immutable recovery evidence')
  }
  console.log('PostgreSQL backup and restore drill preserved immutable evidence.')
} finally {
  await Promise.allSettled([source.dispose(), target.dispose()])
}

function recoveryEvidence() {
  const configuration = {
    executionPlanDigest: expectedDigest,
    profile: { id: 'profile', version: 'v1', digest: `sha256:${'1'.repeat(64)}` },
    skills: [],
    graph: { id: 'graph', version: 'v1', digest: `sha256:${'2'.repeat(64)}` },
    runtime: { id: 'runtime', version: 'v1', digest: `sha256:${'3'.repeat(64)}` },
    model: { id: 'model', version: 'v1', digest: `sha256:${'4'.repeat(64)}` },
    tools: [],
    policy: { id: 'policy', version: 'v1', digest: `sha256:${'5'.repeat(64)}` },
  }
  const dataset = { id: 'dataset', version: 'v1', digest: `sha256:${'6'.repeat(64)}` }
  return {
    evalRunId: expectedRunId,
    suite: {
      evalSuiteId: 'restore-suite',
      version: 'v1',
      digest: `sha256:${'7'.repeat(64)}`,
      dataset,
      mode: 'offline',
      cases: [
        {
          evalCaseId: 'restore-case',
          inputDigest: `sha256:${'8'.repeat(64)}`,
          scorers: [
            {
              metric: 'functional_correctness',
              direction: 'min',
              threshold: 1,
              required: true,
            },
          ],
        },
      ],
    },
    configuration,
    results: [
      {
        evalCaseId: 'restore-case',
        dataset,
        configuration,
        metrics: { functional_correctness: 1 },
        failedRequiredMetrics: [],
        status: 'passed',
      },
    ],
    aggregateMetrics: { functional_correctness: 1 },
    status: 'passed',
    startedAt: '2026-08-25T12:00:00.000Z',
    completedAt: '2026-08-25T12:00:01.000Z',
  }
}

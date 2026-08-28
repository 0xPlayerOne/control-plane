import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import { test } from 'bun:test'

const readRepositoryFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('defines the Railway cloud service and migration manifest', async () => {
  const manifest = JSON.parse(await readRepositoryFile('infrastructure/railway/services.json'))
  const services = manifest.profiles.cloud.services

  assert.deepEqual(
    services.map(({ name }) => name),
    ['control-api', 'workflow-worker', 'runtime-worker', 'runtime-gateway', 'tool-gateway']
  )
  assert.deepEqual(
    services.filter(({ public: isPublic }) => isPublic).map(({ name }) => name),
    ['control-api']
  )
  assert.deepEqual(manifest.profiles.cloud.migration.requires, ['DATABASE_MIGRATION_URL'])
  assert.equal(
    manifest.profiles.cloud.migration.command,
    'bun --cwd=packages/database run db:migrate'
  )
})

test('uses a dependency-aware portable container build without AWS deployment assumptions', async () => {
  const dockerfile = await readRepositoryFile('infrastructure/containers/Dockerfile')
  const bake = await readRepositoryFile('infrastructure/containers/docker-bake.hcl')
  const entrypoint = await readRepositoryFile('infrastructure/containers/entrypoint.sh')

  assert.match(dockerfile, /bun install --frozen-lockfile/)
  assert.match(dockerfile, /^USER bun$/m)
  assert.doesNotMatch(dockerfile, /^\s*(?:ARG|ENV)\s+.*(?:PASSWORD|SECRET|TOKEN|PRIVATE_KEY)/im)
  assert.match(bake, /context\s*=\s*"\."/)
  assert.doesNotMatch(bake, /platforms\s*=\s*\["linux\/arm64"\]/)
  assert.doesNotMatch(`${dockerfile}\n${bake}\n${entrypoint}`, /ECS|Terraform|ECR|AWS/i)
  for (const service of [
    'control-api',
    'workflow-worker',
    'runtime-worker',
    'runtime-gateway',
    'tool-gateway',
  ]) {
    assert.match(bake, new RegExp(`target "${service}"`))
    assert.match(bake, new RegExp(`APP_NAME = "${service}"`))
    assert.match(entrypoint, new RegExp(`\\b${service}\\b`))
  }
  assert.match(bake, /target "database-migrate"/)
  assert.match(dockerfile, /packages\/database.*db:migrate/s)
  assert.doesNotMatch(entrypoint, /\beval\b/)
})

test('does not retain the former AWS deployment tree', async () => {
  const packageManifest = JSON.parse(await readRepositoryFile('package.json'))
  const railwayValidator = await readRepositoryFile('scripts/validate-railway.mjs')
  const infrastructureDocs = await readRepositoryFile('docs/infrastructure.md')

  assert.equal(packageManifest.scripts['infra:validate'], 'bun scripts/validate-railway.mjs')
  assert.equal(packageManifest.scripts['infra:fmt:check'], undefined)
  assert.match(railwayValidator, /Railway cloud manifest/)
  assert.match(infrastructureDocs, /Cloud, Hosted\/VPS, and Local/)
  await assert.rejects(
    readRepositoryFile('infrastructure/terraform/environments/production/main.tf')
  )
})

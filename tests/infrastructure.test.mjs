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
    ['control-api', 'workflow-worker']
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

test('pins a durable private Restate runtime for Railway cloud', async () => {
  const manifest = JSON.parse(await readRepositoryFile('infrastructure/railway/restate.json'))

  assert.deepEqual(manifest.server, {
    service: 'restate',
    version: '1.7.7',
    image:
      'docker.restate.dev/restatedev/restate:1.7.7@sha256:dd1695b61c9de877d24bf9afe8a0ac5fb0f66d175c1bc397975d2252bd784eb2',
    nodeName: 'control-plane-staging-1',
    dataMount: '/restate-data',
    healthPath: '/health',
    privatePorts: { ingress: 8080, admin: 9070, fabric: 5122 },
    public: false,
    environment: {
      RESTATE_CLUSTER_NAME: 'control-plane-staging',
      RESTATE_NODE_NAME: 'control-plane-staging-1',
      RESTATE_AUTO_PROVISION: 'true',
      RESTATE_REQUEST_IDENTITY_PRIVATE_KEY_PEM_FILE: '/restate-data/request-identity-private.pem',
    },
  })
})

test('owns the active Railway project graph as code without committed secrets', async () => {
  const source = await readRepositoryFile('.railway/railway.ts')

  assert.match(source, /defineRailway/)
  assert.match(source, /service\('@control-plane\/control-api'/)
  assert.match(source, /service\('@control-plane\/workflow-worker'/)
  assert.match(source, /service\('restate'/)
  assert.match(source, /volume\('restate-data'/)
  assert.match(source, /docker\.restate\.dev\/restatedev\/restate:1\.7\.7@sha256:/)
  assert.match(source, /healthcheckPath: '\/ready'/)
  assert.match(source, /['"]\/restate-data['"]: restateData/)
  assert.match(source, /DATABASE_URL: preserve\(\)/)
  assert.match(source, /RESTATE_INGRESS_URL:/)
  assert.match(source, /RESTATE_REQUEST_IDENTITY_PUBLIC_KEY: preserve\(\)/)
  assert.doesNotMatch(source, /RESTATE_SERVICE_AUTH_TOKEN/)
  assert.doesNotMatch(source, /(?:PASSWORD|SECRET|TOKEN|PRIVATE_KEY):\s*['"][^'"]+['"]/)
  assert.doesNotMatch(
    source,
    /service\('@control-plane\/(?:runtime-worker|runtime-gateway|tool-gateway)'/
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

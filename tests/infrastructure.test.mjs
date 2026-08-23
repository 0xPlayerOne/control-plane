import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import { test } from 'bun:test'

const services = [
  'control-api',
  'workflow-worker',
  'runtime-worker',
  'runtime-gateway',
  'tool-gateway',
]

const readRepositoryFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('defines reproducible non-root container builds for every deployable service', async () => {
  const dockerfile = await readRepositoryFile('infrastructure/containers/Dockerfile')
  const bake = await readRepositoryFile('infrastructure/containers/docker-bake.hcl')
  const entrypoint = await readRepositoryFile('infrastructure/containers/entrypoint.sh')
  const manifest = JSON.parse(await readRepositoryFile('package.json'))

  assert.match(dockerfile, /^FROM oven\/bun:1\.3\.14-alpine AS /m)
  assert.match(dockerfile, /bun install --frozen-lockfile/)
  assert.match(dockerfile, /^USER bun$/m)
  assert.doesNotMatch(dockerfile, /^\s*(?:ARG|ENV)\s+.*(?:PASSWORD|SECRET|TOKEN|PRIVATE_KEY)/im)
  assert.match(bake, /context\s*=\s*"\."/)
  assert.doesNotMatch(bake, /context\s*=\s*"\.\.\//)

  for (const service of services) {
    assert.match(bake, new RegExp(`target "${service}"`))
    assert.match(bake, new RegExp(`APP_NAME = "${service}"`))
  }
  assert.match(bake, /target "database-migrate"/)
  assert.match(bake, /target\s*=\s*"migration"/)
  assert.match(dockerfile, /packages\/database.*db:migrate/s)
  for (const service of services) assert.match(entrypoint, new RegExp(`\\b${service}\\b`))
  assert.doesNotMatch(entrypoint, /\beval\b/)
  assert.match(manifest.scripts['containers:print'], /docker buildx bake/)
  assert.match(manifest.scripts['containers:build'], /docker buildx bake/)
})

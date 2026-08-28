import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(
  await readFile(`${repositoryRoot}/infrastructure/railway/services.json`, 'utf8')
)
const restate = JSON.parse(
  await readFile(`${repositoryRoot}/infrastructure/railway/restate.json`, 'utf8')
)

if (manifest.schemaVersion !== 1 || manifest.provider !== 'railway') {
  throw new Error('Railway service manifest must use schemaVersion 1 and provider railway.')
}

if (
  restate.schemaVersion !== 1 ||
  restate.runtime !== 'restate' ||
  restate.service !== 'workflow-worker' ||
  restate.railwayPortVariable !== 'PORT' ||
  restate.port !== 9080 ||
  !Array.isArray(restate.handlers) ||
  !restate.handlers.includes('run') ||
  !restate.handlers.includes('respondToInteraction') ||
  !restate.handlers.includes('cancelExecution')
) {
  throw new Error('Railway Restate contract is incomplete or points at the wrong service.')
}

const cloud = manifest.profiles?.cloud
if (!cloud || cloud.environment !== 'managed-cloud') {
  throw new Error('Railway manifest must define the managed-cloud profile.')
}

const expected = new Set([
  'control-api',
  'workflow-worker',
  'runtime-worker',
  'runtime-gateway',
  'tool-gateway',
])
const services = cloud.services ?? []
if (
  services.length !== expected.size ||
  new Set(services.map(({ name }) => name)).size !== expected.size
) {
  throw new Error('Railway manifest must define each cloud service exactly once.')
}

for (const service of services) {
  if (!expected.has(service.name) || service.app !== service.name) {
    throw new Error(`Invalid Railway service mapping: ${service.name ?? '<unnamed>'}.`)
  }
  if (typeof service.public !== 'boolean' || !Array.isArray(service.requires)) {
    throw new Error(`Invalid Railway service contract: ${service.name}.`)
  }
  if (service.name === 'workflow-worker' && (!service.healthPath || !service.readyPath)) {
    throw new Error(`Restate workflow endpoint must define health/readiness: ${service.name}.`)
  }
  if (service.public && (!service.healthPath || !service.readyPath)) {
    throw new Error(`Public Railway service must define health/readiness: ${service.name}.`)
  }
}

if (
  services
    .filter(({ public: isPublic }) => isPublic)
    .map(({ name }) => name)
    .join() !== 'control-api'
) {
  throw new Error('Only control-api may be public in the cloud profile.')
}

if (
  cloud.migration?.command !== 'bun --cwd=packages/database run db:migrate' ||
  JSON.stringify(cloud.migration?.requires) !== JSON.stringify(['DATABASE_MIGRATION_URL'])
) {
  throw new Error('Railway migration must remain an explicit DATABASE_MIGRATION_URL job.')
}

console.log(`Validated Railway cloud manifest for ${services.length} services.`)

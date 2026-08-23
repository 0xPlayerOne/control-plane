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

  assert.match(
    dockerfile,
    /^FROM oven\/bun:1\.3\.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS /m
  )
  assert.match(dockerfile, /bun install --frozen-lockfile/)
  assert.match(dockerfile, /^USER bun$/m)
  assert.doesNotMatch(dockerfile, /^\s*(?:ARG|ENV)\s+.*(?:PASSWORD|SECRET|TOKEN|PRIVATE_KEY)/im)
  assert.match(bake, /context\s*=\s*"\."/)
  assert.match(bake, /platforms\s*=\s*\["linux\/arm64"\]/)
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

test('separates Terraform state and service configuration by environment', async () => {
  const manifest = JSON.parse(await readRepositoryFile('package.json'))
  const gitignore = await readRepositoryFile('infrastructure/terraform/.gitignore')

  for (const environment of ['development', 'staging', 'production']) {
    const root = `infrastructure/terraform/environments/${environment}`
    const backend = await readRepositoryFile(`${root}/backend.tf`)
    const main = await readRepositoryFile(`${root}/main.tf`)
    const variables = await readRepositoryFile(`${root}/variables.tf`)
    const example = await readRepositoryFile(`${root}/terraform.tfvars.example`)
    const outputs = await readRepositoryFile(`${root}/outputs.tf`)

    assert.match(backend, new RegExp(`control-plane/${environment}/terraform\\.tfstate`))
    assert.match(backend, /use_lockfile\s*=\s*true/)
    assert.match(main, /module "environment"/)
    assert.match(main, new RegExp(`environment\\s*=\\s*"${environment}"`))
    assert.match(variables, /variable "image_references"/)
    assert.match(outputs, /database_migration_task_definition_arn/)
    assert.match(outputs, /private_subnet_ids/)
    assert.match(outputs, /service_security_group_id/)
    for (const service of services) assert.match(example, new RegExp(`${service}\\s*=`))
  }

  assert.match(manifest.scripts['infra:fmt:check'], /terraform/)
  assert.match(manifest.scripts['infra:validate'], /validate-terraform/)
  assert.match(gitignore, /^\*\.tfvars$/m)
  assert.match(gitignore, /^!\*\.tfvars\.example$/m)
})

test('models AWS dependencies without leaking secrets or Kubernetes into service images', async () => {
  const platform = await readRepositoryFile('infrastructure/terraform/modules/aws-platform/main.tf')
  const service = await readRepositoryFile('infrastructure/terraform/modules/ecs-service/main.tf')
  const environment = await readRepositoryFile(
    'infrastructure/terraform/modules/environment/main.tf'
  )
  const terraformSources = `${platform}\n${service}\n${environment}`

  for (const resource of [
    'aws_vpc',
    'aws_db_instance',
    'aws_s3_bucket',
    'aws_elasticache_replication_group',
    'aws_kms_key',
    'aws_secretsmanager_secret',
    'aws_ecs_cluster',
  ]) {
    assert.match(platform, new RegExp(`resource "${resource}"`))
  }
  assert.doesNotMatch(platform, /aws_secretsmanager_secret_version/)
  assert.match(
    platform,
    /name\s*=\s*"\$\{var\.project_name\}\/\$\{var\.environment\}\/\$\{each\.value\}"/
  )
  assert.match(platform, /logs\.\$\{var\.aws_region\}\.\$\{data\.aws_partition\.current\.dns_suffix\}/)
  assert.match(platform, /kms:EncryptionContext:aws:logs:arn/)
  assert.match(service, /readonlyRootFilesystem/)
  assert.match(service, /secrets\s*=/)
  assert.match(service, /aws_ecs_task_definition/)
  assert.match(environment, /module "database_migration"/)
  assert.match(environment, /create_service\s*=\s*false/)
  assert.match(environment, /DATABASE_MIGRATION_URL/)
  assert.doesNotMatch(terraformSources, /kubernetes/i)
  assert.doesNotMatch(terraformSources, /(?:temporal|litellm|e2b).*resource/is)
})

test('documents deployment authority, operations, and deliberate deferrals', async () => {
  const documentation = await readRepositoryFile('docs/infrastructure.md')
  const readme = await readRepositoryFile('README.md')

  for (const topic of [
    'authoritative',
    'replaceable',
    'deferred',
    'migration',
    'rollout',
    'rollback',
    'secret rotation',
    'health',
    'development',
    'staging',
    'production',
    'Temporal',
    'LiteLLM',
    'E2B',
  ]) {
    assert.match(documentation, new RegExp(topic, 'i'))
  }
  assert.match(documentation, /database-migrate/)
  assert.match(documentation, /digest/i)
  assert.match(documentation, /populate.*outside Terraform/is)
  assert.match(documentation, /no Kubernetes/i)
  assert.match(readme, /docs\/infrastructure\.md/)
})

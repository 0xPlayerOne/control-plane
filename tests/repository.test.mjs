import assert from 'node:assert/strict'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'
import { test } from 'bun:test'
import { ESLint } from 'eslint'

const apps = ['control-api', 'workflow-worker', 'runtime-worker', 'runtime-gateway', 'tool-gateway']
const packages = [
  'bootstrap',
  'config',
  'domain',
  'contracts',
  'database',
  'events',
  'telemetry',
  'testing',
  'execution-plan',
  'runtime-sdk',
  'tool-sdk',
  'policy',
  'context',
]

async function readJson(path) {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'))
}

test('pins the required Node and Bun toolchain', async () => {
  const manifest = await readJson('package.json')

  assert.equal(manifest.packageManager, 'bun@1.3.14')
  assert.equal(manifest.engines.node, '>=24 <25')
  assert.equal(manifest.engines.bun, '>=1.3.14 <2')
  assert.equal(
    (await readFile(new URL('../.node-version', import.meta.url), 'utf8')).trim(),
    '24.18.0'
  )
  assert.equal(
    (await readFile(new URL('../.bun-version', import.meta.url), 'utf8')).trim(),
    '1.3.14'
  )
})

test('defines root quality and build commands', async () => {
  const manifest = await readJson('package.json')

  for (const script of [
    'build',
    'lint',
    'test',
    'test:unit',
    'test:integration',
    'test:foundation',
    'test:coverage',
    'format',
    'format:check',
    'check:boundaries',
  ]) {
    assert.equal(typeof manifest.scripts[script], 'string', `${script} must be defined`)
  }
})

test('provides a documented isolated integration-test runner', async () => {
  const runner = await readFile(
    new URL('../scripts/run-integration-tests.mjs', import.meta.url),
    'utf8'
  )
  const documentation = await readFile(new URL('../docs/testing.md', import.meta.url), 'utf8')

  assert.match(runner, /docker compose/)
  assert.match(runner, /RUN_DATABASE_INTEGRATION/)
  assert.match(documentation, /bun run test:foundation/)
  assert.match(documentation, /unit/i)
  assert.match(documentation, /integration/i)
  assert.match(documentation, /contract/i)
  assert.match(documentation, /failure-injection/i)
  assert.match(documentation, /end-to-end/i)
})

test('scaffolds every application with an executable placeholder target', async () => {
  for (const app of apps) {
    const manifest = await readJson(`apps/${app}/package.json`)
    const source = await readFile(new URL(`../apps/${app}/src/index.ts`, import.meta.url), 'utf8')

    assert.equal(manifest.name, `@control-plane/${app}`)
    assert.equal(manifest.private, true)
    assert.equal(manifest.browser, false)
    assert.equal(manifest.engines.node, '>=24 <25')
    assert.equal(typeof manifest.scripts.build, 'string')
    assert.equal(typeof manifest.scripts.start, 'string')
    assert.equal(typeof manifest.scripts.lint, 'string')
    assert.equal(typeof manifest.scripts.test, 'string')
    assert.match(source, /serviceName/)
    assert.match(source, /bootstrapService/)
  }
})

test('scaffolds every internal package with server-only public exports', async () => {
  for (const packageName of packages) {
    const manifest = await readJson(`packages/${packageName}/package.json`)

    assert.equal(manifest.name, `@control-plane/${packageName}`)
    assert.equal(manifest.private, true)
    assert.equal(manifest.browser, false)
    assert.deepEqual(manifest.files, ['dist'])
    assert.deepEqual(
      Object.keys(manifest.exports),
      packageName === 'database'
        ? ['.', './migration', './testing']
        : packageName === 'testing'
          ? ['.', './postgres']
          : ['.']
    )
    assert.equal(manifest.exports['.'].types, './dist/index.d.ts')
    assert.equal(manifest.exports['.'].node, './dist/index.js')
    assert.equal(manifest.exports['.'].default, './dist/index.js')
    assert.equal(typeof manifest.scripts.build, 'string')
    assert.equal(typeof manifest.scripts.lint, 'string')
    assert.equal(typeof manifest.scripts.test, 'string')
  }
})

test('configures strict TypeScript and dependency-boundary checks', async () => {
  const tsconfig = await readJson('tsconfig.base.json')
  const manifest = await readJson('package.json')
  const eslintConfig = await readFile(new URL('../eslint.config.js', import.meta.url), 'utf8')

  assert.equal(tsconfig.compilerOptions.strict, true)
  assert.match(manifest.scripts['check:boundaries'], /turbo boundaries/)
  for (const prohibited of [
    '@langchain/langgraph',
    '@modelcontextprotocol',
    '@temporalio',
    '@e2b',
    'litellm',
    'pi-ai',
  ]) {
    assert.match(eslintConfig, new RegExp(prohibited.replaceAll('/', '\\/')))
  }
})

test('keeps observability vendor SDKs behind the telemetry package boundary', async () => {
  const vendorPattern = /@opentelemetry|@sentry/

  for (const packageName of [
    'domain',
    'contracts',
    'events',
    'execution-plan',
    'runtime-sdk',
    'tool-sdk',
    'policy',
    'context',
  ]) {
    const manifest = await readFile(
      new URL(`../packages/${packageName}/package.json`, import.meta.url),
      'utf8'
    )
    const source = await readFile(
      new URL(`../packages/${packageName}/src/index.ts`, import.meta.url),
      'utf8'
    )

    assert.doesNotMatch(manifest, vendorPattern)
    assert.doesNotMatch(source, vendorPattern)
  }
})

test('rejects database contracts in Control API controllers', async () => {
  const cwd = fileURLToPath(new URL('../', import.meta.url))
  const fixture = new URL(
    '../apps/control-api/src/system/database-contract.boundary-test.controller.ts',
    import.meta.url
  )
  await writeFile(fixture, 'import "@control-plane/database";\n')

  try {
    const eslint = new ESLint({ cwd })
    const [result] = await eslint.lintFiles([fileURLToPath(fixture)])

    assert.equal(result.errorCount, 1)
    assert.equal(result.messages[0]?.ruleId, 'no-restricted-imports')
  } finally {
    await unlink(fixture)
  }
})

test('rejects live database imports from core packages', async () => {
  const cwd = fileURLToPath(new URL('../', import.meta.url))
  const fixture = new URL(
    '../packages/domain/src/database-import.boundary-test.ts',
    import.meta.url
  )
  await writeFile(fixture, 'import "@control-plane/database";\n')

  try {
    const eslint = new ESLint({ cwd })
    const [result] = await eslint.lintFiles([fileURLToPath(fixture)])

    assert.equal(result.errorCount, 1)
    assert.equal(result.messages[0]?.ruleId, 'no-restricted-imports')
  } finally {
    await unlink(fixture)
  }
})

test('rejects concrete vendor imports from core packages', async () => {
  const cwd = fileURLToPath(new URL('../', import.meta.url))
  const fixture = new URL('../packages/domain/src/vendor-import.boundary-test.ts', import.meta.url)
  await writeFile(fixture, 'import "@temporalio/client";\n')

  try {
    const eslint = new ESLint({ cwd })
    const [result] = await eslint.lintFiles([fileURLToPath(fixture)])

    assert.equal(result.errorCount, 1)
    assert.equal(result.messages[0]?.ruleId, 'no-restricted-imports')
  } finally {
    await unlink(fixture)
  }
})

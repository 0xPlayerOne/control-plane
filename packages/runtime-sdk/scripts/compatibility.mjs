import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { format } from 'prettier'
import { z } from 'zod'
import { RuntimeCompatibilityMatrixSchema } from '../src/index.ts'

const matrixUrl = new URL(
  '../../../docs/runtime-compatibility/runtime-certifications.v1.json',
  import.meta.url
)
const schemaUrl = new URL(
  '../../../docs/runtime-compatibility/runtime-certifications.schema.json',
  import.meta.url
)

export function compatibilityJsonSchema() {
  return {
    $id: 'https://schemas.control-plane.dev/runtime/runtime-certifications.v1.json',
    title: 'Control Plane Runtime Compatibility Certifications v1',
    ...z.toJSONSchema(RuntimeCompatibilityMatrixSchema),
  }
}

const matrix = RuntimeCompatibilityMatrixSchema.parse(JSON.parse(await readFile(matrixUrl, 'utf8')))
for (const certification of matrix.certifications) {
  for (const evidence of certification.evidence) {
    await access(new URL(`../../../${evidence.source}`, import.meta.url))
  }
}
const expected = await format(JSON.stringify(compatibilityJsonSchema()), {
  parser: 'json',
  printWidth: 100,
})

if (import.meta.main) {
  if (process.argv.includes('--check')) {
    const actual = await readFile(schemaUrl, 'utf8').catch(() => '')
    if (actual !== expected) throw new Error('Runtime compatibility JSON schema is out of date')
  } else {
    await Bun.write(fileURLToPath(schemaUrl), expected)
  }
}

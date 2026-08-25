import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { format } from 'prettier'
import { z } from 'zod'
import { GatewayEnvelopeSchema } from '../src/index.ts'

const outputUrl = new URL('../schema/gateway-envelope.v1.json', import.meta.url)

export function gatewayJsonSchema() {
  return {
    $id: 'https://schemas.control-plane.dev/runtime-gateway/gateway-envelope.v1.json',
    title: 'Control Plane Runtime Gateway Envelope v1',
    ...z.toJSONSchema(GatewayEnvelopeSchema),
    'x-control-plane-prohibitedPayloadKeys': [
      'credential',
      'databaseId',
      'endpoint',
      'executable',
      'localPath',
      'password',
      'privateKey',
      'projectId',
      'sourceScope',
      'token',
      'url',
    ],
  }
}

const expected = await format(JSON.stringify(gatewayJsonSchema()), {
  parser: 'json',
  printWidth: 100,
})

if (import.meta.main) {
  if (process.argv.includes('--check')) {
    const actual = await readFile(outputUrl, 'utf8').catch(() => '')
    if (actual !== expected) throw new Error('Runtime Gateway JSON schema is out of date')
  } else {
    await Bun.write(fileURLToPath(outputUrl), expected)
  }
}

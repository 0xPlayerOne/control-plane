import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import {
  createControlApiOpenApiDocument,
  findBreakingContractChanges,
} from '../scripts/openapi.mjs'

describe('Control API generated contract', () => {
  test('matches the committed OpenAPI artifact deterministically', async () => {
    const generated = createControlApiOpenApiDocument()
    const committed = JSON.parse(
      await readFile(new URL('../openapi/control-plane.v1.json', import.meta.url), 'utf8')
    )

    expect(generated).toEqual(committed)
    expect(Object.keys(generated.paths).sort()).toEqual([
      '/v1/authentication/verify',
      '/v1/context-packages/resolve',
      '/v1/executions/validate',
      '/v1/profiles/resolve',
      '/v1/project-states/resolve',
      '/v1/runtimes/list',
    ])
  })

  test('allows additive optional fields while rejecting breaking v1 changes', () => {
    const baseline = createControlApiOpenApiDocument()
    const additive = globalThis.structuredClone(baseline)
    additive.paths['/v1/profiles/resolve'].post.responses['200'].content[
      'application/json'
    ].schema.properties.data.properties.optionalFutureField = { type: 'string' }
    expect(findBreakingContractChanges(baseline, additive)).toEqual([])

    const removedOperation = globalThis.structuredClone(baseline)
    delete removedOperation.paths['/v1/profiles/resolve']
    expect(findBreakingContractChanges(baseline, removedOperation)).toContain(
      'Removed operation POST /v1/profiles/resolve'
    )

    const requiredRequestField = globalThis.structuredClone(baseline)
    const requestSchema =
      requiredRequestField.paths['/v1/runtimes/list'].post.requestBody.content['application/json']
        .schema
    requestSchema.properties.requiredFutureField = { type: 'string' }
    requestSchema.required.push('requiredFutureField')
    expect(findBreakingContractChanges(baseline, requiredRequestField)).toContain(
      'Request POST /v1/runtimes/list added required field requiredFutureField'
    )

    const expandedEnum = globalThis.structuredClone(baseline)
    const statusEnum =
      expandedEnum.paths['/v1/runtimes/list'].post.responses['200'].content['application/json']
        .schema.properties.data.properties.runtimes.items.properties.status.enum
    statusEnum.push('unknown')
    expect(findBreakingContractChanges(baseline, expandedEnum)).toContain(
      'Response POST /v1/runtimes/list changed closed enum at data.runtimes[].status'
    )
  })
})

import { describe, expect, test } from 'bun:test'
import { ToolDefinitionSchema, ToolVersionSchema } from './index.ts'

const definition = {
  toolDefinitionId: 'tld_01JABCDEF0123456789ABCDEFG',
  name: 'files.read',
  displayName: 'Read file',
  description: 'Reads an explicitly scoped file.',
  ownership: { scope: 'workspace', workspaceId: 'wsp_01JABCDEF0123456789ABCDEFG' },
  createdAt: '2026-08-25T08:00:00.000Z',
}

const version = {
  toolVersionId: 'tlv_01JABCDEF0123456789ABCDEFG',
  toolDefinitionId: definition.toolDefinitionId,
  semanticVersion: '1.0.0',
  revision: 1,
  lifecycle: 'published',
  contentDigest: `sha256:${'a'.repeat(64)}`,
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string', maxLength: 256 } },
    required: ['path'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: { content: { type: 'string' } },
    required: ['content'],
    additionalProperties: false,
  },
  operations: [
    {
      name: 'read',
      requiredCapabilities: ['filesystem.read'],
      riskClass: 'low',
      approvalMode: 'never',
      idempotency: 'inherent',
    },
  ],
  executor: { type: 'internal', reference: 'files-v1' },
  limits: { maxInputBytes: 1024, maxOutputBytes: 4096, timeoutMs: 5_000 },
  createdAt: '2026-08-25T08:01:00.000Z',
  publishedAt: '2026-08-25T08:02:00.000Z',
}

describe('canonical tool contracts', () => {
  test('models a provider-neutral, version-pinned tool contract', () => {
    expect(ToolDefinitionSchema.parse(definition)).toEqual(definition)
    expect(ToolVersionSchema.parse(version)).toEqual(version)
    expect(['internal', 'connector', 'mcp', 'sandbox']).toContain(version.executor.type)
  })

  test('rejects credentials and malformed operation metadata', () => {
    expect(() => ToolDefinitionSchema.parse({ ...definition, credential: 'secret' })).toThrow()
    expect(() =>
      ToolVersionSchema.parse({
        ...version,
        executor: { ...version.executor, apiKey: 'secret' },
      })
    ).toThrow()
    expect(() =>
      ToolVersionSchema.parse({
        ...version,
        operations: [{ ...version.operations[0], requiredCapabilities: ['Filesystem.Read'] }],
      })
    ).toThrow()
  })
})

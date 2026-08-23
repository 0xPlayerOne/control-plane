import { describe, expect, test } from 'bun:test'
import {
  ArtifactReferenceSchema,
  ContractVersionSchema,
  ErrorClassSchema,
  EventEnvelopeSchema,
  IdentifierSchemas,
  PublicContractFixtures,
  ReadRequestEnvelopeSchema,
  ResponseEnvelopeSchema,
  RuntimeReadModelEnvelopeSchema,
  StateChangingCommandEnvelopeSchema,
  UsageEnvelopeSchema,
  assessContractCompatibility,
  negotiateContractVersion,
} from './index.ts'

describe('canonical identifiers', () => {
  test('accepts only the canonical opaque prefix for each identifier kind', () => {
    const fixtures = {
      requestId: 'req_01JABCDEF0123456789ABCDEFG',
      commandId: 'cmd_01JABCDEF0123456789ABCDEFG',
      workspaceId: 'wsp_01JABCDEF0123456789ABCDEFG',
      projectId: 'prj_01JABCDEF0123456789ABCDEFG',
      taskId: 'tsk_01JABCDEF0123456789ABCDEFG',
      agentId: 'agt_01JABCDEF0123456789ABCDEFG',
      profileId: 'prf_01JABCDEF0123456789ABCDEFG',
      profileVersionId: 'pfv_01JABCDEF0123456789ABCDEFG',
      skillVersionId: 'skv_01JABCDEF0123456789ABCDEFG',
      executionId: 'exe_01JABCDEF0123456789ABCDEFG',
      attemptId: 'att_01JABCDEF0123456789ABCDEFG',
      workflowId: 'wfl_01JABCDEF0123456789ABCDEFG',
      interactionId: 'int_01JABCDEF0123456789ABCDEFG',
      runtimeNodeRefId: 'rnr_01JABCDEF0123456789ABCDEFG',
      runtimeConnectionId: 'rtc_01JABCDEF0123456789ABCDEFG',
      externalSessionId: 'ses_01JABCDEF0123456789ABCDEFG',
      artifactId: 'art_01JABCDEF0123456789ABCDEFG',
      eventId: 'evt_01JABCDEF0123456789ABCDEFG',
      traceId: 'trc_01JABCDEF0123456789ABCDEFG',
    }

    for (const [kind, value] of Object.entries(fixtures)) {
      expect(IdentifierSchemas[kind].parse(value)).toBe(value)
      expect(IdentifierSchemas[kind].safeParse(`wrong_${value}`).success).toBe(false)
    }
  })

  test('rejects raw database and runtime-native identifier shapes', () => {
    expect(
      IdentifierSchemas.executionId.safeParse('550e8400-e29b-41d4-a716-446655440000').success
    ).toBe(false)
    expect(IdentifierSchemas.workflowId.safeParse('temporal/workflow/run-123').success).toBe(false)
    expect(
      IdentifierSchemas.runtimeNodeRefId.safeParse('/Users/example/runtime-node').success
    ).toBe(false)
  })
})

describe('contract version compatibility', () => {
  test('classifies same-major additive versions in both consumption directions', () => {
    expect(
      assessContractCompatibility({
        consumer: { major: 1, minor: 2 },
        producer: { major: 1, minor: 4 },
      })
    ).toEqual({ compatible: true, direction: 'backward-compatible' })
    expect(
      assessContractCompatibility({
        consumer: { major: 1, minor: 4 },
        producer: { major: 1, minor: 2 },
      })
    ).toEqual({ compatible: true, direction: 'forward-compatible' })
  })

  test('rejects breaking major changes and negotiates the highest common boundary', () => {
    expect(
      assessContractCompatibility({
        consumer: { major: 1, minor: 9 },
        producer: { major: 2, minor: 0 },
      })
    ).toEqual({ compatible: false, direction: 'breaking' })

    expect(
      negotiateContractVersion(
        [
          { major: 1, minor: 3 },
          { major: 2, minor: 1 },
        ],
        [
          { major: 1, minor: 5 },
          { major: 2, minor: 0 },
        ]
      )
    ).toEqual({ major: 2, minor: 0 })
    expect(negotiateContractVersion([{ major: 1, minor: 0 }], [{ major: 2, minor: 0 }])).toBe(
      undefined
    )
  })

  test('rejects invalid version numbers', () => {
    expect(ContractVersionSchema.safeParse({ major: 0, minor: 1 }).success).toBe(false)
    expect(ContractVersionSchema.safeParse({ major: 1, minor: -1 }).success).toBe(false)
  })
})

describe('versioned public envelopes', () => {
  test('requires retry and correlation metadata on every state-changing command', () => {
    expect(StateChangingCommandEnvelopeSchema.parse(PublicContractFixtures.command)).toEqual(
      PublicContractFixtures.command
    )

    for (const requiredField of [
      'contractVersion',
      'requestId',
      'commandId',
      'idempotencyKey',
      'workspaceId',
      'payloadHash',
      'correlation',
      'operation',
      'issuedAt',
      'payload',
    ]) {
      const incomplete = Object.fromEntries(
        Object.entries(PublicContractFixtures.command).filter(([field]) => field !== requiredField)
      )
      expect(StateChangingCommandEnvelopeSchema.safeParse(incomplete).success).toBe(false)
    }
  })

  test('validates request, response, event, usage, Artifact, and runtime read-model fixtures', () => {
    expect(ReadRequestEnvelopeSchema.parse(PublicContractFixtures.request)).toBeDefined()
    expect(ResponseEnvelopeSchema.parse(PublicContractFixtures.response)).toBeDefined()
    expect(EventEnvelopeSchema.parse(PublicContractFixtures.event)).toBeDefined()
    expect(UsageEnvelopeSchema.parse(PublicContractFixtures.usage)).toBeDefined()
    expect(ArtifactReferenceSchema.parse(PublicContractFixtures.artifact)).toBeDefined()
    expect(RuntimeReadModelEnvelopeSchema.parse(PublicContractFixtures.runtime)).toBeDefined()
  })

  test('distinguishes every normalized failure class', () => {
    expect(ErrorClassSchema.options).toEqual([
      'validation',
      'authentication',
      'authorization',
      'conflict',
      'stale_reference',
      'capability_mismatch',
      'runtime_unavailable',
      'internal',
    ])

    for (const errorClass of ErrorClassSchema.options) {
      expect(
        ResponseEnvelopeSchema.safeParse({
          ...PublicContractFixtures.errorResponse,
          error: { ...PublicContractFixtures.errorResponse.error, class: errorClass },
        }).success
      ).toBe(true)
    }
  })

  test('accepts additive envelope fields without requiring vendor or harness details', () => {
    expect(
      StateChangingCommandEnvelopeSchema.safeParse({
        ...PublicContractFixtures.command,
        additiveFutureField: 'ignored-by-v1-consumers',
      }).success
    ).toBe(true)

    const serializedFixtures = JSON.stringify(PublicContractFixtures).toLowerCase()
    for (const prohibitedTerm of [
      'temporal',
      'langgraph',
      'litellm',
      'claude',
      'codex',
      'pi_',
      'mcp_',
      'providercredential',
      'databaseid',
    ]) {
      expect(serializedFixtures).not.toContain(prohibitedTerm)
    }
  })
})

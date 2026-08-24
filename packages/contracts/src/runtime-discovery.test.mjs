import { describe, expect, test } from 'bun:test'
import {
  ExternalSessionDiscoveryReadModelSchema,
  ExternalSessionGetRequestSchema,
  RuntimeConnectionDiscoveryReadModelSchema,
  RuntimeConnectionListRequestSchema,
} from './index.ts'

const ids = {
  workspaceId: 'wsp_01JABCDEF0123456789ABCDEFG',
  projectId: 'prj_01JABCDEF0123456789ABCDEFG',
  requestId: 'req_01JABCDEF0123456789ABCDEFG',
  traceId: 'trc_01JABCDEF0123456789ABCDEFG',
  runtimeConnectionId: 'rtc_01JABCDEF0123456789ABCDEFG',
  runtimeDefinitionId: 'rtd_01JABCDEF0123456789ABCDEFG',
  runtimeNodeRefId: 'rnr_01JABCDEF0123456789ABCDEFG',
  externalSessionId: 'ses_01JABCDEF0123456789ABCDEFG',
}

const requestContext = {
  caller: { servicePrincipalId: 'svc_agent-hq' },
  contractVersion: { major: 1, minor: 0 },
  requestId: ids.requestId,
  workspaceId: ids.workspaceId,
  projectId: ids.projectId,
  correlation: { traceId: ids.traceId },
  requestedAt: '2026-08-24T12:00:00.000Z',
}

describe('runtime discovery public contracts', () => {
  test('defines bounded workspace/node filters and opaque cursor pagination', () => {
    expect(
      RuntimeConnectionListRequestSchema.parse({
        ...requestContext,
        operation: 'runtime-connection.list',
        parameters: {
          cursor: 'cur_cnRjXzAxSkFCQ0RFRjAxMjM0NTY3ODlBQkNERUZH',
          limit: 25,
          runtimeNodeRefId: ids.runtimeNodeRefId,
          states: ['degraded', 'stale'],
          requiredCapabilities: ['session.resume'],
        },
      }).parameters.limit
    ).toBe(25)
  })

  test('represents capability mismatch and stale inventory without exposing native state', () => {
    const model = RuntimeConnectionDiscoveryReadModelSchema.parse({
      runtimeConnectionId: ids.runtimeConnectionId,
      runtimeDefinitionId: ids.runtimeDefinitionId,
      family: 'codex',
      connectionType: 'managed_local',
      location: 'local_device',
      status: 'unavailable',
      node: {
        runtimeNodeRefId: ids.runtimeNodeRefId,
        location: 'local_device',
        status: 'online',
        health: 'online',
        observedAt: '2026-08-24T11:59:00.000Z',
      },
      connection: {
        status: 'degraded',
        health: 'degraded',
        availability: 'stale',
      },
      freshness: {
        state: 'stale',
        observedAt: '2026-08-24T11:50:00.000Z',
        expiresAt: '2026-08-24T11:55:00.000Z',
      },
      versions: { adapter: '1.2.0', driver: '1.1.0', harness: '2.0.0' },
      capabilities: ['session.resume'],
      capabilityDetails: [
        { name: 'session.resume', support: 'degraded', limitations: ['HISTORY_UNAVAILABLE'] },
      ],
      compatibility: { state: 'incompatible', limitations: ['DRIVER_MAJOR_MISMATCH'] },
      access: {
        localProjectGrant: { required: true, state: 'missing' },
        entitlement: { state: 'allowed', class: 'standard' },
      },
      eligibility: {
        state: 'ineligible',
        reasons: ['REQUIRED_CAPABILITY_INSUFFICIENT', 'RUNTIME_STALE'],
        degradations: [],
        remediation: [
          { code: 'REFRESH_RUNTIME', label: 'Refresh runtime health and capabilities' },
          { code: 'GRANT_PROJECT_ACCESS', label: 'Grant runtime access to this project' },
        ],
      },
      observedAt: '2026-08-24T11:50:00.000Z',
      limitations: ['HISTORY_UNAVAILABLE'],
      opaqueNativeRef: 'nref_01JABCDEF0123456789ABCDEFG',
      rawPath: '/Users/example/.runtime',
      processHandle: 4412,
      credentials: { token: 'secret' },
      nativeConfig: { unrestricted: true },
    })

    expect(model.node.health).toBe('online')
    expect(model.connection.health).toBe('degraded')
    expect(model.freshness.state).toBe('stale')
    expect(model.eligibility.reasons).toContain('REQUIRED_CAPABILITY_INSUFFICIENT')
    const serialized = JSON.stringify(model)
    for (const prohibited of [
      'opaqueNativeRef',
      'rawPath',
      'processHandle',
      'credentials',
      'nativeConfig',
      'secret',
    ]) {
      expect(serialized).not.toContain(prohibited)
    }
  })

  test('represents revoked and offline external sessions with operation-specific controls', () => {
    const model = ExternalSessionDiscoveryReadModelSchema.parse({
      externalSessionId: ids.externalSessionId,
      runtimeConnectionId: ids.runtimeConnectionId,
      projectId: ids.projectId,
      state: 'revoked',
      recoverable: false,
      display: { origin: 'native_discovery', displayName: 'Review session' },
      freshness: {
        state: 'expired',
        observedAt: '2026-08-24T11:00:00.000Z',
        expiresAt: '2026-08-24T11:05:00.000Z',
      },
      capabilitySummary: {
        version: 4,
        operations: ['session.resume'],
        controls: {
          reference: { available: true },
          resume: { available: false, reason: 'SESSION_REVOKED' },
          load: { available: false, reason: 'SESSION_REVOKED' },
          close: { available: false, reason: 'SESSION_REVOKED' },
          history: { available: false, reason: 'SESSION_REVOKED' },
        },
      },
      limitations: ['SESSION_REVOKED'],
      opaqueNativeSessionId: 'nses_01JABCDEF0123456789ABCDEFG',
      nativeSessionState: { messages: ['private'] },
    })

    expect(model.capabilitySummary.controls.resume).toEqual({
      available: false,
      reason: 'SESSION_REVOKED',
    })
    expect(JSON.stringify(model)).not.toContain('opaqueNativeSessionId')
    expect(JSON.stringify(model)).not.toContain('nativeSessionState')

    expect(
      ExternalSessionGetRequestSchema.parse({
        ...requestContext,
        operation: 'external-session.get',
        parameters: { externalSessionId: ids.externalSessionId },
      }).workspaceId
    ).toBe(ids.workspaceId)
  })
})

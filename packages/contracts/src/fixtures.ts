const contractVersion = { major: 1, minor: 0 } as const
const requestId = 'req_01JABCDEF0123456789ABCDEFG'
const commandId = 'cmd_01JABCDEF0123456789ABCDEFG'
const workspaceId = 'wsp_01JABCDEF0123456789ABCDEFG'
const projectId = 'prj_01JABCDEF0123456789ABCDEFG'
const traceId = 'trc_01JABCDEF0123456789ABCDEFG'
const correlation = { traceId }

export const PublicContractFixtures = Object.freeze({
  command: {
    contractVersion,
    requestId,
    commandId,
    idempotencyKey: 'intent-01JABCDEF0123456789ABCDEFG',
    workspaceId,
    projectId,
    payloadHash: 'a'.repeat(64),
    correlation,
    operation: 'execution.submit',
    issuedAt: '2026-08-23T12:00:00.000Z',
    payload: { objective: 'Validate the public contract' },
  },
  request: {
    contractVersion,
    requestId,
    workspaceId,
    projectId,
    correlation,
    operation: 'runtime.list',
    requestedAt: '2026-08-23T12:00:00.000Z',
    parameters: { status: 'available' },
  },
  response: {
    contractVersion,
    requestId,
    correlation,
    data: { accepted: true },
  },
  errorResponse: {
    contractVersion,
    requestId,
    correlation,
    error: {
      class: 'validation',
      code: 'INVALID_REQUEST',
      message: 'The request is invalid',
      retryable: false,
    },
  },
  event: {
    contractVersion,
    eventId: 'evt_01JABCDEF0123456789ABCDEFG',
    eventType: 'execution.accepted',
    occurredAt: '2026-08-23T12:00:00.000Z',
    workspaceId,
    projectId,
    correlation: { ...correlation, causationCommandId: commandId },
    data: { executionId: 'exe_01JABCDEF0123456789ABCDEFG' },
  },
  usage: {
    contractVersion,
    requestId,
    workspaceId,
    executionId: 'exe_01JABCDEF0123456789ABCDEFG',
    recordedAt: '2026-08-23T12:00:01.000Z',
    correlation,
    usage: {
      inputTokens: 100,
      outputTokens: 40,
      durationMs: 1_200,
      cost: { amount: '0.0042', currency: 'USD' },
    },
  },
  artifact: {
    contractVersion,
    artifactId: 'art_01JABCDEF0123456789ABCDEFG',
    version: 1,
    mediaType: 'application/json',
    digest: `sha256:${'b'.repeat(64)}`,
    sizeBytes: 128,
    locator: 'artifact://art_01JABCDEF0123456789ABCDEFG/1',
  },
  runtime: {
    contractVersion,
    runtimeNodeRefId: 'rnr_01JABCDEF0123456789ABCDEFG',
    runtimeConnectionId: 'rtc_01JABCDEF0123456789ABCDEFG',
    status: 'available',
    observedAt: '2026-08-23T12:00:00.000Z',
    readModel: { location: 'local', healthy: true },
  },
})

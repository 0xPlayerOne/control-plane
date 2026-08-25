import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import process from 'node:process'
import { loadDatabaseCredentials } from '@control-plane/config'
import {
  CommandInboxService,
  ExecutionLifecycleService,
  ExecutionReconciliationService,
  InteractionService,
} from '@control-plane/domain'
import { ExecutionEventDispatcher, ExecutionEventService } from '@control-plane/events'
import {
  ExternalSessionRegistry,
  RecordingRuntimeAvailabilityChangePublisher,
  RuntimeConnectionRegistry,
  RuntimeHealthIngestionService,
} from '@control-plane/runtime-sdk'
import { PostgresCommandAcceptanceRepository } from './command-inbox-repository.ts'
import { PostgresExecutionEventRepository } from './execution-event-repository.ts'
import { PostgresExternalSessionRepository } from './external-session-repository.ts'
import { PostgresExecutionRepository } from './execution-repository.ts'
import { PostgresInteractionRepository } from './interaction-repository.ts'
import { PostgresReconciliationCheckpointRepository } from './reconciliation-checkpoint-repository.ts'
import { PostgresRuntimeConnectionRepository } from './runtime-connection-repository.ts'
import { PostgresRuntimeCommandRepository } from './runtime-command-repository.ts'
import {
  commandInbox,
  executions,
  externalSessions,
  inboxMessages,
  interactionRequests,
  outboxEvents,
  reconciliationCheckpoints,
  runtimeCommands,
  runtimeConnections,
} from './schema/index.ts'
import { createIsolatedTestDatabase } from './testing.ts'

const integrationEnabled = process.env.RUN_DATABASE_INTEGRATION === 'true'

describe.skipIf(!integrationEnabled)('PostgreSQL persistence foundation', () => {
  let isolated

  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase({
      administration: loadDatabaseCredentials(process.env, 'administration'),
      application: loadDatabaseCredentials(process.env, 'application'),
      migration: loadDatabaseCredentials(process.env, 'migration'),
    })
  })

  afterAll(async () => {
    await isolated?.dispose()
  })

  test('migrates an empty database and re-applies migrations deterministically', async () => {
    await isolated.migrate()
    await isolated.migrate()

    const result = await isolated.application.execute(sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
      order by table_name
    `)
    expect(result.map(({ table_name: tableName }) => tableName)).toEqual(
      expect.arrayContaining([
        'execution_attempts',
        'executions',
        'external_sessions',
        'inbox_messages',
        'outbox_events',
        'reconciliation_checkpoints',
        'runtime_connections',
      ])
    )
  })

  test('persists idempotent runtime inventory and optimistic lifecycle updates', async () => {
    await isolated.migrate()
    const repository = new PostgresRuntimeConnectionRepository(isolated.application)
    const registry = new RuntimeConnectionRegistry(repository)
    const registration = {
      runtimeConnectionId: 'rtc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      identityDigest: `sha256:${'d'.repeat(64)}`,
      connectionType: 'managed_local',
      runtimeNodeRefId: 'rnr_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      runtimeDefinitionId: 'rtd_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      location: 'local_device',
      opaqueNativeRef: 'nref_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      adapterVersion: '1.0.0',
      driverVersion: '1.0.0',
      harnessVersion: '1.0.0',
      status: 'connected',
      health: 'healthy',
      capabilities: [{ name: 'stream.output', support: 'supported' }],
      compatibilityState: 'compatible',
      limitations: [],
      lastDiscoveredAt: '2026-08-24T20:00:00.000Z',
      lastHeartbeatAt: '2026-08-24T20:00:00.000Z',
      lastHealthCheckAt: '2026-08-24T20:00:00.000Z',
      expiresAt: '2026-08-24T20:10:00.000Z',
    }
    const [first, replay] = await Promise.all([
      registry.register(registration),
      registry.register(registration),
    ])

    expect(replay).toEqual(first)
    expect(await registry.listByRuntimeNode(registration.runtimeNodeRefId)).toEqual([first])
    const update = {
      runtimeConnectionId: first.runtimeConnectionId,
      expectedVersion: first.version,
      observedAt: '2026-08-24T20:01:00.000Z',
      lastHeartbeatAt: '2026-08-24T20:01:00.000Z',
      status: 'degraded',
      health: 'degraded',
      compatibilityState: 'degraded',
    }
    const outcomes = await Promise.allSettled([
      registry.update(update),
      registry.update({ ...update, limitations: ['Concurrent health report'] }),
    ])
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1)

    const executionRepository = new PostgresExecutionRepository(isolated.application)
    const executionService = new ExecutionLifecycleService(executionRepository)
    const execution = await executionService.createExecution({
      executionId: 'exe_01ARZ3NDEKTSV4RRFFQ69G5FAH',
      correlation: {
        workspaceId: 'wsp_01ARZ3NDEKTSV4RRFFQ69G5FAH',
        projectId: 'prj_01ARZ3NDEKTSV4RRFFQ69G5FAH',
        taskId: 'tsk_01ARZ3NDEKTSV4RRFFQ69G5FAH',
        agentId: 'agt_01ARZ3NDEKTSV4RRFFQ69G5FAH',
        requestId: 'req_01ARZ3NDEKTSV4RRFFQ69G5FAH',
      },
      executionPlan: {
        executionPlanId: 'pln_01ARZ3NDEKTSV4RRFFQ69G5FAH',
        contentDigest: `sha256:${'e'.repeat(64)}`,
        schemaVersion: 1,
      },
      acceptedAt: '2026-08-24T20:01:00.000Z',
    })
    const historicalAttempt = await executionService.createAttempt({
      executionId: execution.executionId,
      attemptId: 'att_01ARZ3NDEKTSV4RRFFQ69G5FAH',
      expectedExecutionVersion: execution.version,
      queuedAt: '2026-08-24T20:01:30.000Z',
      runtime: { runtimeConnectionId: first.runtimeConnectionId },
    })
    const current = await registry.get(first.runtimeConnectionId)
    const revoked = await registry.revoke({
      runtimeConnectionId: first.runtimeConnectionId,
      expectedVersion: current.version,
      observedAt: '2026-08-24T20:02:00.000Z',
    })
    expect(revoked.status).toBe('revoked')
    expect(await executionRepository.getAttempt(historicalAttempt.attemptId)).toMatchObject({
      runtime: { runtimeConnectionId: revoked.runtimeConnectionId },
    })
    expect(await isolated.application.select().from(runtimeConnections)).toHaveLength(1)
  })

  test('persists runtime command delivery state across gateway repository restarts', async () => {
    await isolated.migrate()
    const runtimeConnectionId = 'rtc_01ARZ3NDEKTSV4RRFFQ69G5FAM'
    const nodeId = 'rnr_01ARZ3NDEKTSV4RRFFQ69G5FAM'
    const workspaceId = 'wsp_01ARZ3NDEKTSV4RRFFQ69G5FAM'
    const runtimeRegistry = new RuntimeConnectionRegistry(
      new PostgresRuntimeConnectionRepository(isolated.application)
    )
    await runtimeRegistry.register({
      runtimeConnectionId,
      identityDigest: `sha256:${'8'.repeat(64)}`,
      connectionType: 'managed_local',
      runtimeNodeRefId: nodeId,
      runtimeDefinitionId: 'rtd_01ARZ3NDEKTSV4RRFFQ69G5FAM',
      location: 'local_device',
      opaqueNativeRef: 'nref_01ARZ3NDEKTSV4RRFFQ69G5FAM',
      adapterVersion: '1.0.0',
      driverVersion: '1.0.0',
      harnessVersion: '1.0.0',
      status: 'connected',
      health: 'healthy',
      capabilities: [{ name: 'stream.output', support: 'supported' }],
      compatibilityState: 'compatible',
      limitations: [],
      lastDiscoveredAt: '2026-08-24T23:00:00.000Z',
      lastHeartbeatAt: '2026-08-24T23:00:00.000Z',
      lastHealthCheckAt: '2026-08-24T23:00:00.000Z',
    })
    const executionService = new ExecutionLifecycleService(
      new PostgresExecutionRepository(isolated.application)
    )
    const execution = await executionService.createExecution({
      executionId: 'exe_01ARZ3NDEKTSV4RRFFQ69G5FAM',
      correlation: {
        workspaceId,
        projectId: 'prj_01ARZ3NDEKTSV4RRFFQ69G5FAM',
        taskId: 'tsk_01ARZ3NDEKTSV4RRFFQ69G5FAM',
        agentId: 'agt_01ARZ3NDEKTSV4RRFFQ69G5FAM',
        requestId: 'req_01ARZ3NDEKTSV4RRFFQ69G5FAM',
      },
      executionPlan: {
        executionPlanId: 'pln_01ARZ3NDEKTSV4RRFFQ69G5FAM',
        contentDigest: `sha256:${'7'.repeat(64)}`,
        schemaVersion: 1,
      },
      acceptedAt: '2026-08-24T23:00:00.000Z',
    })
    const attempt = await executionService.createAttempt({
      executionId: execution.executionId,
      attemptId: 'att_01ARZ3NDEKTSV4RRFFQ69G5FAM',
      expectedExecutionVersion: execution.version,
      queuedAt: '2026-08-24T23:00:01.000Z',
      runtime: { runtimeConnectionId },
    })
    const record = {
      commandId: 'cmd_01ARZ3NDEKTSV4RRFFQ69G5FAM',
      executionId: execution.executionId,
      attemptId: attempt.attemptId,
      nodeId,
      runtimeConnectionId,
      workspaceId,
      idempotencyKey: 'runtime-command:integration:1',
      payloadHash: `sha256:${'6'.repeat(64)}`,
      commandEnvelope: { type: 'command', payload: { operation: 'runtime.execute' } },
      issuedAt: '2026-08-24T23:00:01.000Z',
      expiresAt: '2026-08-24T23:05:01.000Z',
      status: 'queued',
      version: 1,
      deliveryAttempts: 0,
      createdAt: '2026-08-24T23:00:01.000Z',
      updatedAt: '2026-08-24T23:00:01.000Z',
    }
    const repository = new PostgresRuntimeCommandRepository(isolated.application)
    expect((await repository.create(record)).outcome).toBe('created')
    expect((await repository.create(record)).outcome).toBe('duplicate')

    const restarted = new PostgresRuntimeCommandRepository(isolated.application)
    expect(await restarted.listDispatchable(nodeId, '2026-08-24T23:00:02.000Z', 10)).toEqual([
      record,
    ])
    expect(await restarted.compareAndSet(1, { ...record, version: 2 })).toBe(true)
    expect(await restarted.compareAndSet(1, { ...record, version: 3 })).toBe(false)
    expect(await isolated.application.select().from(runtimeCommands)).toHaveLength(1)
  })

  test('persists versioned health ingestion and freshness across service restarts', async () => {
    const repository = new PostgresRuntimeConnectionRepository(isolated.application)
    const registry = new RuntimeConnectionRegistry(repository)
    const runtimeConnectionId = 'rtc_01ARZ3NDEKTSV4RRFFQ69G5FAJ'
    await registry.register({
      runtimeConnectionId,
      identityDigest: `sha256:${'f'.repeat(64)}`,
      connectionType: 'managed_local',
      runtimeNodeRefId: 'rnr_01ARZ3NDEKTSV4RRFFQ69G5FAJ',
      runtimeDefinitionId: 'rtd_01ARZ3NDEKTSV4RRFFQ69G5FAJ',
      location: 'local_device',
      opaqueNativeRef: 'nref_01ARZ3NDEKTSV4RRFFQ69G5FAJ',
      adapterVersion: '1.0.0',
      driverVersion: '1.0.0',
      harnessVersion: '1.0.0',
      status: 'connected',
      health: 'healthy',
      capabilities: [],
      compatibilityState: 'untested',
      limitations: [],
      lastDiscoveredAt: '2026-08-24T21:00:00.000Z',
      lastHeartbeatAt: '2026-08-24T21:00:00.000Z',
      lastHealthCheckAt: '2026-08-24T21:00:00.000Z',
    })
    const policy = {
      adapterMajor: 1,
      driverMajor: 1,
      harnessMajor: 1,
      protocolMajor: 1,
      healthTtlMs: 60_000,
      maximumCapabilityTtlMs: 60_000,
    }
    const report = {
      runtimeConnectionId,
      reportSequence: 1,
      observedAt: '2026-08-24T21:01:00.000Z',
      discoveredAt: '2026-08-24T21:00:30.000Z',
      nodeStatus: 'online',
      runtimeState: 'healthy',
      versions: {
        adapter: '1.0.0',
        driver: '1.0.0',
        harness: '1.0.0',
        protocol: '1.0.0',
      },
      capabilitySnapshot: {
        version: 1,
        observedAt: '2026-08-24T21:01:00.000Z',
        ttlMs: 60_000,
        verification: 'verified',
        source: 'adapter_driver_negotiation',
        capabilities: [{ name: 'stream.output', support: 'supported' }],
      },
      limitations: [],
      diagnostics: [],
    }
    const changes = new RecordingRuntimeAvailabilityChangePublisher()
    const ingestion = new RuntimeHealthIngestionService({ registry, changes, policy })
    const healthy = await ingestion.ingest(report, '2026-08-24T21:01:10.000Z')
    expect(healthy.connection).toMatchObject({
      availabilityState: 'healthy',
      protocolVersion: '1.0.0',
      capabilitySnapshotVersion: 1,
      capabilityVerification: 'verified',
      lastHealthReportSequence: 1,
      lastDiscoveredAt: '2026-08-24T21:00:30.000Z',
    })
    expect(changes.events).toHaveLength(1)

    const restartedChanges = new RecordingRuntimeAvailabilityChangePublisher()
    const restarted = new RuntimeHealthIngestionService({
      registry: new RuntimeConnectionRegistry(
        new PostgresRuntimeConnectionRepository(isolated.application)
      ),
      changes: restartedChanges,
      policy,
    })
    expect(await restarted.ingest(report, '2026-08-24T21:01:20.000Z')).toMatchObject({
      applied: false,
      reason: 'replayed_report',
    })
    const stale = await restarted.refresh({
      runtimeConnectionId,
      nodeStatus: 'offline',
      evaluatedAt: '2026-08-24T21:02:01.000Z',
    })
    expect(stale).toMatchObject({
      applied: true,
      connection: { availabilityState: 'stale', status: 'unavailable' },
      assessment: {
        nodeStatus: 'offline',
        executable: false,
        diagnostics: expect.arrayContaining(['CAPABILITY_SNAPSHOT_STALE', 'NODE_OFFLINE']),
      },
    })
    expect(restartedChanges.events).toHaveLength(1)
  })

  test('persists scoped external session references without native ownership transfer', async () => {
    await isolated.migrate()
    const runtimeConnectionId = 'rtc_01ARZ3NDEKTSV4RRFFQ69G5FAK'
    const runtimeRegistry = new RuntimeConnectionRegistry(
      new PostgresRuntimeConnectionRepository(isolated.application)
    )
    await runtimeRegistry.register({
      runtimeConnectionId,
      identityDigest: `sha256:${'9'.repeat(64)}`,
      connectionType: 'managed_local',
      runtimeNodeRefId: 'rnr_01ARZ3NDEKTSV4RRFFQ69G5FAK',
      runtimeDefinitionId: 'rtd_01ARZ3NDEKTSV4RRFFQ69G5FAK',
      location: 'local_device',
      opaqueNativeRef: 'nref_01ARZ3NDEKTSV4RRFFQ69G5FAK',
      adapterVersion: '1.0.0',
      driverVersion: '1.0.0',
      harnessVersion: '1.0.0',
      status: 'connected',
      health: 'healthy',
      capabilities: [{ name: 'session.resume', support: 'supported' }],
      compatibilityState: 'compatible',
      limitations: [],
      lastDiscoveredAt: '2026-08-24T22:00:00.000Z',
      lastHeartbeatAt: '2026-08-24T22:00:00.000Z',
      lastHealthCheckAt: '2026-08-24T22:00:00.000Z',
    })
    const registry = new ExternalSessionRegistry(
      new PostgresExternalSessionRepository(isolated.application)
    )
    const session = await registry.register({
      externalSessionId: 'ses_01ARZ3NDEKTSV4RRFFQ69G5FAK',
      runtimeConnectionId,
      opaqueNativeSessionId: 'nses_01ARZ3NDEKTSV4RRFFQ69G5FAK',
      workspaceId: 'wsp_01ARZ3NDEKTSV4RRFFQ69G5FAK',
      projectId: 'prj_01ARZ3NDEKTSV4RRFFQ69G5FAK',
      state: 'active',
      ownership: {
        authority: 'external_runtime',
        imported: false,
        concurrentNativeUse: 'allowed',
      },
      capabilitySnapshot: {
        version: 1,
        observedAt: '2026-08-24T22:00:00.000Z',
        expiresAt: '2026-08-24T22:01:00.000Z',
        operations: ['session.resume'],
      },
      safeMetadata: {
        origin: 'native_discovery',
        displayName: 'Native planning session',
        limitations: [],
      },
      lastObservedAt: '2026-08-24T22:00:00.000Z',
    })
    const restarted = new ExternalSessionRegistry(
      new PostgresExternalSessionRepository(isolated.application)
    )
    expect(
      await restarted.list({
        workspaceId: session.workspaceId,
        projectId: session.projectId,
        runtimeConnectionId,
      })
    ).toEqual([session])
    const removed = await restarted.update({
      externalSessionId: session.externalSessionId,
      expectedVersion: session.version,
      observedAt: '2026-08-24T22:00:30.000Z',
      state: 'removed',
    })
    expect(removed).toMatchObject({ state: 'removed', version: 2 })
    expect(await isolated.application.select().from(externalSessions)).toHaveLength(1)
    expect(JSON.stringify(removed)).not.toContain('/Users/')
    expect(JSON.stringify(removed)).not.toContain('credential')
  })

  test('persists lifecycle transitions and multiple runtime attempts with optimistic concurrency', async () => {
    const repository = new PostgresExecutionRepository(isolated.application)
    const service = new ExecutionLifecycleService(repository)
    const execution = await service.createExecution({
      executionId: 'exe_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      correlation: {
        workspaceId: 'wsp_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        projectId: 'prj_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        taskId: 'tsk_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        agentId: 'agt_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        requestId: 'req_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      },
      executionPlan: {
        executionPlanId: 'pln_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        contentDigest: `sha256:${'a'.repeat(64)}`,
        schemaVersion: 1,
      },
      acceptedAt: '2026-08-23T10:00:00.000Z',
      deadlineAt: '2026-08-23T11:00:00.000Z',
    })
    const firstAttempt = await service.createAttempt({
      executionId: execution.executionId,
      attemptId: 'att_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      expectedExecutionVersion: execution.version,
      queuedAt: '2026-08-23T10:01:00.000Z',
      runtime: {
        runtimeDefinitionId: 'rtd_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        runtimeConnectionId: 'rtc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        routingDecision: {
          routingVersion: 1,
          policy: {
            policyId: 'runtime-standard',
            version: 1,
            digest: `sha256:${'b'.repeat(64)}`,
          },
          evaluatedAt: '2026-08-23T10:00:59.000Z',
          inputDigest: `sha256:${'c'.repeat(64)}`,
          decisionDigest: `sha256:${'d'.repeat(64)}`,
          selectedRank: 1,
          candidateCount: 2,
          reasonCodes: ['HEALTH', 'LOCALITY'],
        },
      },
    })
    const afterFirst = await service.getExecution(execution.executionId)
    const secondAttempt = await service.createAttempt({
      executionId: execution.executionId,
      attemptId: 'att_01ARZ3NDEKTSV4RRFFQ69G5FAW',
      expectedExecutionVersion: afterFirst.version,
      queuedAt: '2026-08-23T10:02:00.000Z',
    })

    expect(firstAttempt.sequence).toBe(1)
    expect(await repository.getAttempt(firstAttempt.attemptId)).toMatchObject({
      runtime: {
        runtimeConnectionId: 'rtc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        routingDecision: {
          routingVersion: 1,
          policy: { policyId: 'runtime-standard', version: 1 },
          selectedRank: 1,
          candidateCount: 2,
        },
      },
    })
    expect(secondAttempt.sequence).toBe(2)
    expect(await repository.listAttempts(execution.executionId)).toHaveLength(2)
    expect(await service.getExecution(execution.executionId)).toMatchObject({
      version: 3,
      attemptCount: 2,
      latestAttemptId: secondAttempt.attemptId,
    })

    const outcomes = await Promise.allSettled([
      service.transitionAttempt({
        attemptId: secondAttempt.attemptId,
        expectedVersion: secondAttempt.version,
        to: 'starting',
        transitionedAt: '2026-08-23T10:03:00.000Z',
      }),
      service.transitionAttempt({
        attemptId: secondAttempt.attemptId,
        expectedVersion: secondAttempt.version,
        to: 'running',
        transitionedAt: '2026-08-23T10:03:00.000Z',
      }),
    ])
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1)
  })

  test('persists reconciliation checkpoints and replays the decision without repeating effects', async () => {
    const acceptance = new CommandInboxService({
      repository: new PostgresCommandAcceptanceRepository(isolated.application),
      executionIdFactory: () => 'exe_01DRZ3NDEKTSV4RRFFQ69G5FAV',
      executionPlanValidator: { validate: async () => true },
    })
    const { execution } = await acceptance.acceptExecution({
      callerPrincipalId: 'svc_agent-hq',
      operation: 'execution.accept',
      commandId: 'cmd_01DRZ3NDEKTSV4RRFFQ69G5FAV',
      requestId: 'req_01DRZ3NDEKTSV4RRFFQ69G5FAV',
      idempotencyKey: 'reconciliation-integration',
      payloadHash: '8'.repeat(64),
      correlation: {
        workspaceId: 'wsp_01DRZ3NDEKTSV4RRFFQ69G5FAV',
        projectId: 'prj_01DRZ3NDEKTSV4RRFFQ69G5FAV',
        taskId: 'tsk_01DRZ3NDEKTSV4RRFFQ69G5FAV',
        agentId: 'agt_01DRZ3NDEKTSV4RRFFQ69G5FAV',
      },
      executionPlan: {
        executionPlanId: 'pln_01DRZ3NDEKTSV4RRFFQ69G5FAV',
        contentDigest: `sha256:${'7'.repeat(64)}`,
        schemaVersion: 1,
      },
      receivedAt: '2026-08-24T14:00:00.000Z',
      retentionExpiresAt: '2026-09-24T14:00:00.000Z',
    })
    const observation = {
      executionId: execution.executionId,
      checkedAt: '2026-08-24T15:00:00.000Z',
      command: { status: 'accepted', commandId: 'cmd_01DRZ3NDEKTSV4RRFFQ69G5FAV' },
      execution: { state: 'accepted', updatedAt: execution.updatedAt },
      workflow: { status: 'missing' },
      runtime: { status: 'unknown', observedAt: '2026-08-24T15:00:00.000Z' },
      delivery: { pendingCount: 0 },
    }
    const effects = []
    const options = {
      repository: new PostgresReconciliationCheckpointRepository(isolated.application),
      source: {
        load: async () => observation,
        listCandidates: async () => [execution.executionId],
      },
      effects: {
        markReconciliationRequired: async (input) => effects.push(['mark', input]),
        resumeWorkflow: async (input) => effects.push(['resume', input]),
        applyRuntimeTerminal: async (input) => effects.push(['terminal', input]),
        replayEvents: async (input) => effects.push(['replay', input]),
      },
    }

    const first = await new ExecutionReconciliationService(options).reconcile(execution.executionId)
    const replay = await new ExecutionReconciliationService(options).reconcile(
      execution.executionId
    )

    expect(replay).toEqual(first)
    expect(effects.map(([kind]) => kind)).toEqual(['mark', 'resume'])
    expect(
      await isolated.application
        .select()
        .from(reconciliationCheckpoints)
        .where(eq(reconciliationCheckpoints.executionId, execution.executionId))
    ).toHaveLength(1)
  })

  test('atomically accepts one execution for concurrent duplicate commands and audits conflicts', async () => {
    const repository = new PostgresCommandAcceptanceRepository(isolated.application)
    const service = new CommandInboxService({
      repository,
      executionIdFactory: () => 'exe_01BRZ3NDEKTSV4RRFFQ69G5FAV',
      executionPlanValidator: { validate: async () => true },
      now: () => '2026-08-24T11:00:00.000Z',
    })
    const input = {
      callerPrincipalId: 'svc_agent-hq',
      operation: 'execution.accept',
      commandId: 'cmd_01BRZ3NDEKTSV4RRFFQ69G5FAV',
      requestId: 'req_01BRZ3NDEKTSV4RRFFQ69G5FAV',
      idempotencyKey: 'integration-task-1',
      payloadHash: 'c'.repeat(64),
      correlation: {
        workspaceId: 'wsp_01BRZ3NDEKTSV4RRFFQ69G5FAV',
        projectId: 'prj_01BRZ3NDEKTSV4RRFFQ69G5FAV',
        taskId: 'tsk_01BRZ3NDEKTSV4RRFFQ69G5FAV',
        agentId: 'agt_01BRZ3NDEKTSV4RRFFQ69G5FAV',
      },
      executionPlan: {
        executionPlanId: 'pln_01BRZ3NDEKTSV4RRFFQ69G5FAV',
        contentDigest: `sha256:${'d'.repeat(64)}`,
        schemaVersion: 1,
      },
      receivedAt: '2026-08-24T11:00:00.000Z',
      retentionExpiresAt: '2026-09-23T11:00:00.000Z',
    }

    const results = await Promise.all(
      Array.from({ length: 8 }, () => service.acceptExecution(input))
    )

    expect(results.filter(({ replayed }) => !replayed)).toHaveLength(1)
    expect(new Set(results.map(({ execution }) => execution.executionId))).toEqual(
      new Set(['exe_01BRZ3NDEKTSV4RRFFQ69G5FAV'])
    )
    expect(
      await isolated.application
        .select()
        .from(executions)
        .where(eq(executions.taskId, input.correlation.taskId))
    ).toHaveLength(1)

    await expect(
      service.acceptExecution({ ...input, payloadHash: 'e'.repeat(64) })
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_CONFLICT' })
    const [record] = await isolated.application
      .select()
      .from(commandInbox)
      .where(eq(commandInbox.commandId, input.commandId))
    expect(record).toMatchObject({ conflictCount: 1, payloadHash: input.payloadHash })

    const processing = await service.transitionCommand({
      ...input,
      expectedVersion: record.version,
      to: 'processing',
      transitionedAt: '2026-08-24T11:01:00.000Z',
    })
    expect(processing).toMatchObject({ status: 'processing', version: record.version + 1 })
    expect((await service.acceptExecution(input)).command).toEqual(processing)
  })

  test('persists one authorized interaction response across service restarts', async () => {
    const executionRepository = new PostgresExecutionRepository(isolated.application)
    const lifecycle = new ExecutionLifecycleService(executionRepository)
    const execution = await lifecycle.createExecution({
      executionId: 'exe_01CRZ3NDEKTSV4RRFFQ69G5FAV',
      correlation: {
        workspaceId: 'wsp_01CRZ3NDEKTSV4RRFFQ69G5FAV',
        projectId: 'prj_01CRZ3NDEKTSV4RRFFQ69G5FAV',
        taskId: 'tsk_01CRZ3NDEKTSV4RRFFQ69G5FAV',
        agentId: 'agt_01CRZ3NDEKTSV4RRFFQ69G5FAV',
        requestId: 'req_01CRZ3NDEKTSV4RRFFQ69G5FAV',
      },
      executionPlan: {
        executionPlanId: 'pln_01CRZ3NDEKTSV4RRFFQ69G5FAV',
        contentDigest: `sha256:${'f'.repeat(64)}`,
        schemaVersion: 1,
      },
      acceptedAt: '2026-08-24T12:00:00.000Z',
    })
    const attempt = await lifecycle.createAttempt({
      executionId: execution.executionId,
      attemptId: 'att_01CRZ3NDEKTSV4RRFFQ69G5FAV',
      expectedExecutionVersion: execution.version,
      queuedAt: '2026-08-24T12:01:00.000Z',
    })
    const repository = new PostgresInteractionRepository(isolated.application)
    const service = new InteractionService(repository)
    const interaction = await service.request({
      interactionId: 'int_01CRZ3NDEKTSV4RRFFQ69G5FAV',
      executionId: execution.executionId,
      attemptId: attempt.attemptId,
      kind: 'approval',
      prompt: { title: 'Approve the durable operation' },
      allowedActions: ['approve', 'deny'],
      allowedPrincipalIds: ['svc_agent-hq'],
      requestedAt: '2026-08-24T12:02:00.000Z',
      expiresAt: '2026-08-24T13:02:00.000Z',
    })
    const restarted = new InteractionService(
      new PostgresInteractionRepository(isolated.application)
    )
    const response = {
      interactionId: interaction.interactionId,
      executionId: execution.executionId,
      attemptId: attempt.attemptId,
      responseId: 'cmd_01CRZ3NDEKTSV4RRFFQ69G5FAV',
      action: 'approve',
      respondingPrincipalId: 'svc_agent-hq',
      expectedVersion: interaction.version,
      respondedAt: '2026-08-24T12:03:00.000Z',
    }

    expect(await restarted.respond(response)).toMatchObject({ state: 'responded', version: 2 })
    expect(await restarted.respond(response)).toMatchObject({ state: 'responded', version: 2 })
    expect(
      await isolated.application
        .select()
        .from(interactionRequests)
        .where(eq(interactionRequests.interactionId, interaction.interactionId))
    ).toHaveLength(1)
  })

  test('commits execution transitions and ordered outbox events atomically', async () => {
    const repository = new PostgresExecutionEventRepository(isolated.application)
    const service = new ExecutionEventService(repository)
    const executionId = 'exe_01BRZ3NDEKTSV4RRFFQ69G5FAV'
    const executionRepository = new PostgresExecutionRepository(isolated.application)
    const current = await executionRepository.getExecution(executionId)
    const queued = {
      ...current,
      state: 'queued',
      version: current.version + 1,
      queuedAt: '2026-08-24T11:02:00.000Z',
      updatedAt: '2026-08-24T11:02:00.000Z',
    }
    const draft = {
      eventId: 'evt_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      executionId,
      type: 'execution.queued',
      schemaVersion: 1,
      correlation: {
        workspaceId: current.correlation.workspaceId,
        projectId: current.correlation.projectId,
        taskId: current.correlation.taskId,
        agentId: current.correlation.agentId,
        requestId: current.correlation.requestId,
        traceId: 'trc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      },
      payload: { state: 'queued' },
      occurredAt: queued.updatedAt,
      recordedAt: queued.updatedAt,
      retentionExpiresAt: '2026-11-22T11:02:00.000Z',
    }
    expect(await repository.transitionExecution(current.version, queued, draft)).toMatchObject({
      sequence: 1,
    })

    const stored = await executionRepository.getExecution(executionId)
    const running = {
      ...stored,
      state: 'running',
      version: stored.version + 1,
      runningAt: '2026-08-24T11:03:00.000Z',
      updatedAt: '2026-08-24T11:03:00.000Z',
    }
    expect(await repository.transitionExecution(stored.version, running, draft)).toBeUndefined()
    expect((await executionRepository.getExecution(executionId)).version).toBe(stored.version)

    const events = await Promise.all([
      service.append({
        ...draft,
        eventId: 'evt_01BRZ3NDEKTSV4RRFFQ69G5FAV',
        type: 'execution.progressed',
      }),
      service.append({
        ...draft,
        eventId: 'evt_01CRZ3NDEKTSV4RRFFQ69G5FAV',
        type: 'execution.progressed',
      }),
    ])
    expect(events.map(({ sequence }) => sequence).sort()).toEqual([2, 3])
    expect(
      (await repository.queryAfter(executionId, 1, 10)).map(({ sequence }) => sequence)
    ).toEqual([2, 3])

    const delivered = []
    const dispatcher = new ExecutionEventDispatcher({
      repository,
      publicationService: service,
      transport: {
        deliver: async (envelope) => {
          delivered.push(envelope)
          return { outcome: 'accepted' }
        },
      },
      now: () => '2026-08-24T11:04:00.000Z',
    })
    expect(await dispatcher.dispatchBatch(10)).toEqual({
      delivered: 3,
      failed: 0,
      quarantined: 0,
    })
    expect(delivered.map(({ eventId }) => eventId)).toHaveLength(3)
    expect(await repository.queryPending(10)).toEqual([])
  })

  test('commits inbox and outbox writes atomically and rolls them back together', async () => {
    await isolated.transaction(async (transaction) => {
      await transaction.insert(inboxMessages).values({
        consumer: 'integration-test',
        messageId: 'message-1',
        payload: { kind: 'command' },
      })
      await transaction.insert(outboxEvents).values({
        aggregateId: 'aggregate-1',
        aggregateType: 'test',
        eventType: 'test.completed',
        payload: { kind: 'event' },
      })
    })

    await expect(
      isolated.transaction(async (transaction) => {
        await transaction.insert(inboxMessages).values({
          consumer: 'integration-test',
          messageId: 'message-rollback',
          payload: {},
        })
        await transaction.insert(outboxEvents).values({
          aggregateId: 'aggregate-rollback',
          aggregateType: 'test',
          eventType: 'test.rolled_back',
          payload: {},
        })
        throw new Error('rollback')
      })
    ).rejects.toThrow('rollback')

    expect(
      await isolated.application
        .select()
        .from(inboxMessages)
        .where(eq(inboxMessages.consumer, 'integration-test'))
    ).toHaveLength(1)
    expect(
      await isolated.application
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.aggregateType, 'test'))
    ).toHaveLength(1)
  })
})

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import process from 'node:process'
import { loadDatabaseCredentials } from '@control-plane/config'
import {
  CommandInboxService,
  ExecutionLifecycleService,
  InteractionService,
} from '@control-plane/domain'
import { ExecutionEventDispatcher, ExecutionEventService } from '@control-plane/events'
import { PostgresCommandAcceptanceRepository } from './command-inbox-repository.ts'
import { PostgresExecutionEventRepository } from './execution-event-repository.ts'
import { PostgresExecutionRepository } from './execution-repository.ts'
import { PostgresInteractionRepository } from './interaction-repository.ts'
import {
  commandInbox,
  executions,
  inboxMessages,
  interactionRequests,
  outboxEvents,
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
        'inbox_messages',
        'outbox_events',
      ])
    )
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

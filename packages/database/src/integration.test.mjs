import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import process from 'node:process'
import { loadDatabaseCredentials } from '@control-plane/config'
import { CommandInboxService, ExecutionLifecycleService } from '@control-plane/domain'
import { PostgresCommandAcceptanceRepository } from './command-inbox-repository.ts'
import { PostgresExecutionRepository } from './execution-repository.ts'
import { commandInbox, executions, inboxMessages, outboxEvents } from './schema/index.ts'
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

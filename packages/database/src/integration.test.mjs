import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import process from 'node:process'
import { loadDatabaseCredentials } from '@control-plane/config'
import { inboxMessages, outboxEvents } from './schema/index.ts'
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
      expect.arrayContaining(['inbox_messages', 'outbox_events'])
    )
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

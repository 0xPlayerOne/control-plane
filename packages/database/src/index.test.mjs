import { describe, expect, test } from 'bun:test'
import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  createPostgresConnection,
  DatabaseConnectionError,
  inboxMessages,
  outboxEvents,
  persistenceConventions,
  withDomainTransaction,
} from './index.ts'

describe('persistence schema', () => {
  test('defines shared PostgreSQL conventions and domain-organized messaging tables', () => {
    expect(persistenceConventions).toEqual({
      identifiers: 'uuid-v4-database-generated',
      json: 'jsonb',
      names: 'snake_case-plural-tables',
      revisions: 'bigint-starting-at-one',
      softDelete: 'nullable-deleted-at',
      timestamps: 'timestamp-with-time-zone',
    })

    const inbox = getTableConfig(inboxMessages)
    const outbox = getTableConfig(outboxEvents)
    expect(inbox.name).toBe('inbox_messages')
    expect(outbox.name).toBe('outbox_events')
    expect(inbox.columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'id',
        'payload',
        'revision',
        'created_at',
        'updated_at',
        'deleted_at',
      ])
    )
    expect(outbox.columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['id', 'payload', 'status', 'revision', 'created_at', 'updated_at'])
    )
  })
})

describe('createPostgresConnection', () => {
  test('rejects non-PostgreSQL URLs without serializing credentials', () => {
    const url = 'mysql://application:top-secret@database/control_plane'

    try {
      createPostgresConnection({ role: 'application', url })
      throw new Error('Expected connection creation to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseConnectionError)
      expect(JSON.stringify(error)).not.toContain('top-secret')
      expect(error.diagnostic).toEqual({ code: 'INVALID_DATABASE_URL' })
    }
  })

  test('rejects migration credentials from the application connection path', () => {
    expect(() =>
      createPostgresConnection({
        role: 'migration',
        url: 'postgresql://migrator:secret@database/control_plane',
      })
    ).toThrow(DatabaseConnectionError)
  })
})

test('withDomainTransaction applies an atomic serializable transaction boundary', async () => {
  const transaction = { marker: 'transaction' }
  const calls = []
  const database = {
    transaction: async (operation, configuration) => {
      calls.push(configuration)
      return operation(transaction)
    },
  }

  const result = await withDomainTransaction(database, async (context) => {
    expect(context).toBe(transaction)
    return 'committed'
  })

  expect(result).toBe('committed')
  expect(calls).toEqual([
    { accessMode: 'read write', deferrable: false, isolationLevel: 'serializable' },
  ])
})

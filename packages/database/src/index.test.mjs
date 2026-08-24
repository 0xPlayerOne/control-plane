import { describe, expect, test } from 'bun:test'
import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  commandInbox,
  createPostgresConnection,
  DatabaseConnectionError,
  executionAttempts,
  executions,
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
    const command = getTableConfig(commandInbox)
    const outbox = getTableConfig(outboxEvents)
    const execution = getTableConfig(executions)
    const attempt = getTableConfig(executionAttempts)
    expect(inbox.name).toBe('inbox_messages')
    expect(command.name).toBe('command_inbox')
    expect(outbox.name).toBe('outbox_events')
    expect(execution.name).toBe('executions')
    expect(attempt.name).toBe('execution_attempts')
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
    expect(command.columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'command_id',
        'caller_principal_id',
        'operation',
        'idempotency_key',
        'payload_hash',
        'workspace_id',
        'project_id',
        'task_id',
        'request_id',
        'status',
        'execution_id',
        'retention_expires_at',
        'conflict_count',
      ])
    )
    expect(command.indexes.map(({ config }) => config.name)).toEqual(
      expect.arrayContaining([
        'command_inbox_scope_idempotency_unique',
        'command_inbox_status_retention_index',
        'command_inbox_execution_index',
      ])
    )
    expect(execution.columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'execution_id',
        'execution_plan_id',
        'execution_plan_digest',
        'execution_plan_schema_version',
        'workspace_id',
        'project_id',
        'task_id',
        'agent_id',
        'state',
        'version',
        'deadline_at',
        'terminal_result_ref',
      ])
    )
    expect(execution.indexes.map(({ config }) => config.name)).toEqual(
      expect.arrayContaining([
        'executions_scope_index',
        'executions_state_deadline_index',
        'executions_parent_index',
      ])
    )
    expect(attempt.columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'attempt_id',
        'execution_id',
        'sequence',
        'runtime_definition_id',
        'runtime_node_ref_id',
        'runtime_connection_id',
        'state',
        'version',
      ])
    )
    expect(attempt.indexes.map(({ config }) => config.name)).toEqual(
      expect.arrayContaining([
        'execution_attempts_execution_sequence_unique',
        'execution_attempts_state_deadline_index',
        'execution_attempts_runtime_index',
      ])
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

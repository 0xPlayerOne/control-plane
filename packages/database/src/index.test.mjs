import { describe, expect, test } from 'bun:test'
import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  commandInbox,
  createPostgresConnection,
  DatabaseConnectionError,
  executionAttempts,
  executionEvents,
  executions,
  inboxMessages,
  interactionRequests,
  outboxEvents,
  persistenceConventions,
  reconciliationCheckpoints,
  runtimeConnections,
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
    const event = getTableConfig(executionEvents)
    const attempt = getTableConfig(executionAttempts)
    const interaction = getTableConfig(interactionRequests)
    const reconciliation = getTableConfig(reconciliationCheckpoints)
    const runtimeConnection = getTableConfig(runtimeConnections)
    expect(inbox.name).toBe('inbox_messages')
    expect(command.name).toBe('command_inbox')
    expect(outbox.name).toBe('outbox_events')
    expect(execution.name).toBe('executions')
    expect(attempt.name).toBe('execution_attempts')
    expect(interaction.name).toBe('interaction_requests')
    expect(reconciliation.name).toBe('reconciliation_checkpoints')
    expect(runtimeConnection.name).toBe('runtime_connections')
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
    expect(event.columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'event_id',
        'execution_id',
        'workspace_id',
        'project_id',
        'task_id',
        'agent_id',
        'sequence',
        'event_type',
        'payload',
        'payload_hash',
        'publication_status',
        'next_attempt_at',
        'quarantined_at',
      ])
    )
    expect(event.indexes.map(({ config }) => config.name)).toEqual(
      expect.arrayContaining([
        'execution_events_execution_sequence_unique',
        'execution_events_replay_index',
        'execution_events_publication_index',
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
        'routing_decision',
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
    expect(interaction.columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'interaction_id',
        'execution_id',
        'attempt_id',
        'kind',
        'state',
        'version',
        'allowed_principal_ids',
        'expires_at',
        'response',
      ])
    )
    expect(interaction.indexes.map(({ config }) => config.name)).toEqual(
      expect.arrayContaining([
        'interaction_requests_execution_index',
        'interaction_requests_attempt_state_index',
        'interaction_requests_expiry_index',
      ])
    )
    expect(reconciliation.columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'checkpoint_id',
        'execution_id',
        'command_id',
        'attempt_id',
        'workflow_id',
        'runtime_command_id',
        'pending_event_count',
        'observation_hash',
        'reason',
        'action',
        'state',
        'diagnostics',
        'version',
        'checked_at',
      ])
    )
    expect(reconciliation.indexes.map(({ config }) => config.name)).toEqual(
      expect.arrayContaining([
        'reconciliation_checkpoints_observation_unique',
        'reconciliation_checkpoints_execution_index',
        'reconciliation_checkpoints_command_index',
        'reconciliation_checkpoints_state_index',
      ])
    )
    expect(runtimeConnection.columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'runtime_connection_id',
        'identity_digest',
        'connection_type',
        'runtime_node_ref_id',
        'runtime_definition_id',
        'location',
        'opaque_native_ref',
        'adapter_version',
        'driver_version',
        'harness_version',
        'status',
        'health',
        'capabilities',
        'compatibility_state',
        'availability_state',
        'protocol_version',
        'capability_snapshot_version',
        'capability_snapshot_observed_at',
        'capability_snapshot_expires_at',
        'capability_verification',
        'last_health_report_sequence',
        'last_health_report_digest',
        'limitations',
        'diagnostics',
        'last_discovered_at',
        'last_heartbeat_at',
        'last_health_check_at',
        'expires_at',
        'version',
        'created_at',
        'updated_at',
      ])
    )
    expect(
      runtimeConnection.columns.find(({ name }) => name === 'opaque_native_ref')?.getSQLType()
    ).toBe('varchar(31)')
    expect(runtimeConnection.indexes.map(({ config }) => config.name)).toEqual(
      expect.arrayContaining([
        'runtime_connections_identity_unique',
        'runtime_connections_node_index',
        'runtime_connections_status_freshness_index',
        'runtime_connections_availability_freshness_index',
        'runtime_connections_definition_index',
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

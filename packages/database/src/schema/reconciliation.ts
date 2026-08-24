import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'
import { commandInbox } from './commands.js'
import { executions, executionAttempts } from './executions.js'

export const reconciliationReason = pgEnum('reconciliation_reason', [
  'accepted_unstarted',
  'stale_heartbeat',
  'runtime_disconnected',
  'runtime_disappeared',
  'workflow_stalled',
  'runtime_terminal_unrecorded',
  'terminal_undelivered',
  'healthy',
])

export const reconciliationAction = pgEnum('reconciliation_action', [
  'none',
  'resume_existing_workflow',
  'wait_for_runtime',
  'manual_intervention',
  'apply_runtime_terminal',
  'replay_events',
])

export const reconciliationCheckpointState = pgEnum('reconciliation_checkpoint_state', [
  'reconciling',
  'waiting',
  'remediated',
  'manual_intervention',
  'resolved',
])

export const reconciliationCheckpoints = pgTable(
  'reconciliation_checkpoints',
  {
    checkpointId: varchar('checkpoint_id', { length: 36 }).primaryKey(),
    executionId: varchar('execution_id', { length: 30 })
      .notNull()
      .references(() => executions.executionId),
    commandId: varchar('command_id', { length: 30 })
      .notNull()
      .references(() => commandInbox.commandId),
    attemptId: varchar('attempt_id', { length: 30 }).references(() => executionAttempts.attemptId),
    workflowId: varchar('workflow_id', { length: 30 }),
    runtimeCommandId: varchar('runtime_command_id', { length: 256 }),
    pendingEventCount: integer('pending_event_count').notNull(),
    observationHash: varchar('observation_hash', { length: 64 }).notNull(),
    reason: reconciliationReason('reason').notNull(),
    action: reconciliationAction('action').notNull(),
    state: reconciliationCheckpointState('state').notNull(),
    diagnostics: jsonb('diagnostics').$type<string[]>().notNull(),
    version: integer('version').notNull(),
    checkedAt: timestamp('checked_at', { mode: 'date', withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { mode: 'date', withTimezone: true }),
  },
  (table) => [
    uniqueIndex('reconciliation_checkpoints_observation_unique').on(table.observationHash),
    index('reconciliation_checkpoints_execution_index').on(table.executionId, table.checkedAt),
    index('reconciliation_checkpoints_command_index').on(table.commandId),
    index('reconciliation_checkpoints_state_index').on(table.state, table.updatedAt),
  ]
)

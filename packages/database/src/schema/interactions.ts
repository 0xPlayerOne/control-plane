import { index, integer, jsonb, pgEnum, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core'
import { executions, executionAttempts } from './executions.js'

const id = (name: string) => varchar(name, { length: 30 })
export const interactionKind = pgEnum('interaction_kind', [
  'approval',
  'input',
  'permission',
  'resume',
  'cancel',
])
export const interactionState = pgEnum('interaction_state', [
  'pending',
  'responded',
  'expired',
  'cancelled',
])
export const interactionRequests = pgTable(
  'interaction_requests',
  {
    interactionId: id('interaction_id').primaryKey(),
    executionId: id('execution_id')
      .notNull()
      .references(() => executions.executionId),
    attemptId: id('attempt_id')
      .notNull()
      .references(() => executionAttempts.attemptId),
    kind: interactionKind('kind').notNull(),
    state: interactionState('state').notNull(),
    prompt: jsonb('prompt').$type<Record<string, unknown>>().notNull(),
    allowedActions: jsonb('allowed_actions').$type<string[]>().notNull(),
    allowedPrincipalIds: jsonb('allowed_principal_ids').$type<string[]>().notNull(),
    version: integer('version').notNull(),
    requestedAt: timestamp('requested_at', { mode: 'date', withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { mode: 'date', withTimezone: true }).notNull(),
    response: jsonb('response').$type<Record<string, unknown>>(),
    resolvedAt: timestamp('resolved_at', { mode: 'date', withTimezone: true }),
  },
  (table) => [
    index('interaction_requests_execution_index').on(table.executionId, table.requestedAt),
    index('interaction_requests_attempt_state_index').on(table.attemptId, table.state),
    index('interaction_requests_expiry_index').on(table.state, table.expiresAt),
  ]
)

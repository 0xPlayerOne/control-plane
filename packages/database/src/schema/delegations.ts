import {
  bigint,
  index,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'
import type { DelegationRecord } from '@control-plane/orchestration'

export const delegationState = pgEnum('delegation_state', [
  'requested',
  'dispatched',
  'running',
  'awaiting_input',
  'completed',
  'failed',
  'cancelled',
  'manual_intervention',
])

const identifier = (name: string) => varchar(name, { length: 30 })

export const delegations = pgTable(
  'delegations',
  {
    delegationId: identifier('delegation_id').primaryKey(),
    delegationGroupId: identifier('delegation_group_id'),
    parentExecutionId: identifier('parent_execution_id').notNull(),
    childExecutionId: identifier('child_execution_id').notNull(),
    state: delegationState('state').notNull(),
    revision: bigint('revision', { mode: 'number' }).notNull(),
    inputDigest: varchar('input_digest', { length: 71 }).notNull(),
    record: jsonb('record').$type<DelegationRecord>().notNull(),
    acceptedAt: timestamp('accepted_at', { mode: 'date', withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('delegations_child_execution_unique').on(table.childExecutionId),
    index('delegations_parent_state_index').on(table.parentExecutionId, table.state),
    index('delegations_group_index').on(table.delegationGroupId),
  ]
)
